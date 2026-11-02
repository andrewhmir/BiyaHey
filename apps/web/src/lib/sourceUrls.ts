/**
 * Split a provenance row's `url` field into every URL it publishes.
 *
 * Registry rows can carry more than one URL in a single field (the rail row
 * lists LRTA and LRMC separated by `·`). The UI must not silently drop the
 * second source: `FareBreakdown` and the licence sheet render every http(s)
 * entry. The field is still presented verbatim by the licence sheet when it has
 * no URL at all.
 */
export function sourceUrls(value: string): string[] {
  return value
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//.test(part));
}

/** A short, human label for a secondary URL (the host), falling back to the URL. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
