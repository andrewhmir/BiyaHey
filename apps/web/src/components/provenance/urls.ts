/** Split a registry `url` field into the http(s) entries it publishes. */
export function urlsFrom(value: string): string[] {
  return value
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//.test(part));
}

/** A short label for one of a row's URLs (the host), or the URL itself. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
