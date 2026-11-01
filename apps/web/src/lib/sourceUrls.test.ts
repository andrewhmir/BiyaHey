import { describe, expect, it } from 'vitest';
import { sourceHost, sourceUrls } from './sourceUrls';

describe('sourceUrls', () => {
  it('returns every http(s) URL a registry row publishes', () => {
    expect(
      sourceUrls('https://www.lrta.gov.ph/tickets-and-fares/ · https://lrmc.ph'),
    ).toEqual(['https://www.lrta.gov.ph/tickets-and-fares/', 'https://lrmc.ph']);
  });

  it('ignores non-URL text and blank fragments', () => {
    expect(sourceUrls('see registry · https://example.test/a · n/a')).toEqual([
      'https://example.test/a',
    ]);
  });

  it('returns an empty list when the field has no URL', () => {
    expect(sourceUrls('no URL published')).toEqual([]);
    expect(sourceUrls('')).toEqual([]);
  });

  it('labels a secondary URL by its host', () => {
    expect(sourceHost('https://lrmc.ph')).toBe('lrmc.ph');
    expect(sourceHost('not a url')).toBe('not a url');
  });
});
