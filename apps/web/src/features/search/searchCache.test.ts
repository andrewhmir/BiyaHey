import type { SearchResponse } from '@biyahey/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SEARCH_CACHE_KEY,
  SEARCH_CACHE_LIMIT,
  cachedSearchResponse,
  readRecentQueries,
  readSearchCache,
  writeSearchCache,
} from './searchCache';

const response: SearchResponse = {
  partial: false,
  groups: { stops: [], landmarks: [], routes: [], saved: [] },
};

function storedEntries(): { query: string }[] {
  return JSON.parse(window.localStorage.getItem(SEARCH_CACHE_KEY) ?? '[]') as { query: string }[];
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('searchCache', () => {
  it('keeps at most 20 queries, newest first, and de-duplicates repeats', () => {
    for (let index = 0; index < 25; index += 1) {
      writeSearchCache(`query-${index}`, response);
    }

    expect(storedEntries()).toHaveLength(SEARCH_CACHE_LIMIT);
    expect(storedEntries()[0]?.query).toBe('query-24');
    expect(readRecentQueries(3)).toEqual(['query-24', 'query-23', 'query-22']);

    writeSearchCache('query-24', response);

    expect(storedEntries()).toHaveLength(SEARCH_CACHE_LIMIT);
    expect(readRecentQueries(2)).toEqual(['query-24', 'query-23']);
  });

  it('returns a cached response case-insensitively', () => {
    writeSearchCache('Ayala', response);

    expect(cachedSearchResponse('ayala')).toEqual(response);
    expect(cachedSearchResponse('cubao')).toBeUndefined();
  });

  it('ignores corrupt or malformed storage instead of throwing', () => {
    window.localStorage.setItem(SEARCH_CACHE_KEY, '{not json');
    expect(readSearchCache()).toEqual([]);
    expect(cachedSearchResponse('ayala')).toBeUndefined();

    window.localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify([{ query: 'x' }]));
    expect(readSearchCache()).toEqual([]);
    expect(readRecentQueries()).toEqual([]);
  });
});
