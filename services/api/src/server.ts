import { resolveDataDir } from '@biyahey/shared/provenance';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const envDataDir = process.env.BIYAHEY_DATA_DIR;
const dataDir = envDataDir ?? resolveDataDir();
const app = buildApp(envDataDir === undefined ? {} : { dataDir: envDataDir });

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`BiyaHey! API listening on http://localhost:${port}`);
  console.log(`data dir: ${dataDir}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
