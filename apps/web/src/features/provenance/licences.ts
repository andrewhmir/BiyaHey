/**
 * SPDX identifier → human licence name (Task 7's L3 detail).
 *
 * R45: attribution/licence strings come from the API. The registry publishes a
 * machine identifier (`licence_spdx`) and a `licence_url`, not a display name,
 * so this table is the documented presentation mapping the plan allows. It is
 * keyed only by the identifier the API sent; an unknown identifier falls back to
 * the identifier itself rather than inventing a name, and no row here is used
 * as an attribution string.
 *
 * Task 9 (M8): names use the licence's own conventional title ("… v1.0
 * Universal", "… 4.0 International") rather than a truncated paraphrase.
 */
const LICENCE_NAMES: Readonly<Record<string, string>> = {
  'ODbL-1.0': 'Open Database License (ODbL) 1.0',
  'CC-BY-SA-2.0': 'Creative Commons Attribution-ShareAlike 2.0 Generic',
  'CC-BY-4.0': 'Creative Commons Attribution 4.0 International',
  'CC0-1.0': 'Creative Commons Zero v1.0 Universal',
  MIT: 'MIT License',
  // SPDX's own marker for "no licence asserted". A dataset row may still carry
  // a publisher licence URL beside it; a derived row has none, and the sheet
  // states that in plain text instead of rendering a dead anchor.
  NOASSERTION: 'No licence asserted',
};

/** Human licence name for an API licence identifier (identifier when unknown). */
export function licenceName(spdx: string): string {
  const trimmed = spdx.trim();
  if (trimmed.length === 0) {
    return 'No licence asserted';
  }
  return LICENCE_NAMES[trimmed] ?? trimmed;
}
