/**
 * Validates every YAML/JSON data file under `data/` against the JSON Schema
 * found in the matching `data/<area>/schema/` directory.
 *
 * Convention (filename stem first):
 *  - `data/<area>/schema/<name>.schema.json` claims `data/<area>/<name>.yaml`
 *    first (e.g. `rail-tables.schema.json` covers `rail-tables.yaml`).
 *  - It then claims files whose stem starts with `<name>-`
 *    (e.g. `fares.schema.json` covers `fares-2026-09-28.yaml`).
 *  - When an area has a single schema, that schema is also the fallback for
 *    any other data file in the area.
 *  - A data file with no schema is an error, and finding no data files at all
 *    is an error, so an empty run can never masquerade as a pass.
 *
 * Run with `npm run validate:data`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = join(repoRoot, 'data');
const DATA_FILE_PATTERN = /\.(ya?ml|json)$/i;
const SCHEMA_SUFFIX = '.schema.json';
// Generated output under data/ is gitignored and has no schemas: never validate
// data/build/ (pipeline manifest.json, build-report.json, osm/coverage.json) or
// data/snapshots/ (dated feed zips).
const IGNORED_DIRS = new Set(['build', 'snapshots']);

let problems = 0;

function fail(message) {
  console.error(`validate-data: ${message}`);
  problems += 1;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walk(full, files);
      }
    } else {
      files.push(full);
    }
  }
  return files;
}

function displayPath(file) {
  return relative(repoRoot, file).split(sep).join('/');
}

if (!existsSync(dataRoot)) {
  fail('no data/ directory found');
  process.exit(1);
}

const schemas = [];
const dataFiles = [];
for (const file of walk(dataRoot)) {
  if (file.endsWith(SCHEMA_SUFFIX)) {
    schemas.push({
      file,
      area: dirname(dirname(file)),
      stem: basename(file).slice(0, -SCHEMA_SUFFIX.length),
    });
  } else if (DATA_FILE_PATTERN.test(file)) {
    dataFiles.push(file);
  }
}

if (schemas.length === 0) {
  fail('no JSON schemas found under data/**/schema/');
}
if (dataFiles.length === 0) {
  fail('no data files found under data/ - refusing to report a vacuous pass');
}

// Compile every schema up front so schema bugs are reported even before a
// matching data file exists.
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map();
for (const schema of schemas) {
  try {
    const json = JSON.parse(readFileSync(schema.file, 'utf8'));
    validators.set(schema.file, ajv.compile(json));
  } catch (error) {
    fail(
      `invalid schema ${displayPath(schema.file)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// Match each data file to the schema for its area.
const schemasByArea = new Map();
for (const schema of schemas) {
  const areaSchemas = schemasByArea.get(schema.area) ?? [];
  areaSchemas.push(schema);
  schemasByArea.set(schema.area, areaSchemas);
}

/**
 * Match a data file to an area schema by filename stem first:
 * `rail-tables.yaml` -> `rail-tables.schema.json`, then a `<stem>-` prefix
 * (`fares-2026-09-28.yaml` -> `fares.schema.json`), then the area's only
 * schema. Returns `undefined` when an area has several schemas and none match.
 */
function schemaForName(name, areaSchemas) {
  const stem = name.replace(DATA_FILE_PATTERN, '');
  const exact = areaSchemas.find((candidate) => candidate.stem === stem);
  if (exact !== undefined) {
    return exact;
  }
  const prefixed = areaSchemas.find((candidate) => stem.startsWith(`${candidate.stem}-`));
  if (prefixed !== undefined) {
    return prefixed;
  }
  return areaSchemas.length === 1 ? areaSchemas[0] : undefined;
}

const assignments = [];
for (const file of dataFiles) {
  const area = [...schemasByArea.keys()]
    .filter((candidate) => file.startsWith(candidate + sep))
    .sort((a, b) => b.length - a.length)[0];
  if (area === undefined) {
    fail(`no schema directory found for ${displayPath(file)}`);
    continue;
  }
  const schema = schemaForName(basename(file), schemasByArea.get(area));
  if (schema === undefined || !validators.has(schema.file)) {
    fail(`no valid schema found for ${displayPath(file)}`);
    continue;
  }
  assignments.push({ file, schema: schema.file, validate: validators.get(schema.file) });
}

for (const { file, schema, validate } of assignments) {
  let document;
  try {
    const text = readFileSync(file, 'utf8');
    document = file.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseYaml(text);
  } catch (error) {
    fail(
      `${displayPath(file)}: cannot parse (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    continue;
  }
  if (validate(document)) {
    console.log(`ok   ${displayPath(file)} (${displayPath(schema)})`);
    continue;
  }
  problems += 1;
  console.error(`FAIL ${displayPath(file)} (${displayPath(schema)})`);
  for (const error of validate.errors ?? []) {
    console.error(`     ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
  }
}

if (problems === 0 && assignments.length > 0) {
  console.log(`validated ${assignments.length} data file(s) against ${schemas.length} schema(s)`);
}

process.exitCode = problems === 0 ? 0 : 1;
