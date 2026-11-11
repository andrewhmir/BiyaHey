/** SPDX identifier → human licence name. Unknown ids render as the id itself. */
const LICENCE_NAMES: Readonly<Record<string, string>> = {
  'ODbL-1.0': 'Open Database License (ODbL) 1.0',
  'CC-BY-SA-2.0': 'Creative Commons Attribution-ShareAlike 2.0 Generic',
  'CC-BY-4.0': 'Creative Commons Attribution 4.0 International',
  'CC0-1.0': 'Creative Commons Zero v1.0 Universal',
  MIT: 'MIT License',
  NOASSERTION: 'No licence asserted',
};

export function licenceName(spdx: string): string {
  const trimmed = spdx.trim();
  return trimmed.length === 0 ? 'No licence asserted' : (LICENCE_NAMES[trimmed] ?? trimmed);
}
