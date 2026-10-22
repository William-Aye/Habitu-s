import { useCallback, useEffect, useRef, useState } from 'react';
import { searchExplore } from './api';
import type { ExploreParams, ExploreResponse, ExploreResult } from './types';
import { normaliseQuery } from './types';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

export function useExploreSearch(params: ExploreParams | null): {
  response: ExploreResponse | null;
  results: ExploreResult[];
  loading: boolean;
  error: boolean;
  /** The next page failed; the results so far stay. loadMore() retries. */
  loadMoreError: boolean;
  loadMore(): void;
  /** Runs the first-page search again (after `error`). */
  retry(): void;
} {
  const normalised = params ? normaliseQuery(params.query) : '';
  const [debounced, setDebounced] = useState(normalised);
  const [response, setResponse] = useState<ExploreResponse | null>(null);
  const [results, setResults] = useState<ExploreResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const current = useRef<{ params: ExploreParams } | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    if (normalised === debounced) return;
    const t = setTimeout(() => setDebounced(normalised), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [normalised, debounced]);

  const key = params
    ? JSON.stringify([
        debounced,
        params.center,
        params.radiusKm,
        params.kinds,
        params.weekday,
        params.newcomerFriendly,
        params.interestCategoryIds,
        params.sort,
        attempt,
      ])
    : null;

  const paramsRef = useRef(params);
  const resultsRef = useRef(results);
  const responseRef = useRef(response);
  // Mirror latest values for callbacks; declared before the search effect so it
  // reads fresh params.
  useEffect(() => {
    paramsRef.current = params;
    resultsRef.current = results;
    responseRef.current = response;
  });

  useEffect(() => {
    const p = paramsRef.current;
    const id = ++requestId.current;
    loadingMore.current = false;
    if (!p) {
      current.current = null;
      setResponse(null);
      setResults([]);
      setLoading(false);
      setError(false);
      setLoadMoreError(false);
      return;
    }
    const effective = { ...p, query: debounced };
    setLoading(true);
    setError(false);
    setLoadMoreError(false);
    (async () => {
      try {
        const res = await searchExplore(effective, { limit: PAGE_SIZE, offset: 0 });
        if (id !== requestId.current) return;
        current.current = { params: effective };
        setResponse(res);
        setResults(res.results);
        setLoading(false);
      } catch {
        if (id !== requestId.current) return;
        setError(true);
        setLoading(false);
      }
    })();
    return () => {
      // supersede any in-flight request on unmount (a new run bumps it itself)
      requestId.current = id + 1;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    const cur = current.current;
    if (!cur || loadingMore.current || !responseRef.current?.hasMore) return;
    loadingMore.current = true;
    setLoadMoreError(false);
    const id = requestId.current;
    const offset = resultsRef.current.length;
    searchExplore(cur.params, { limit: PAGE_SIZE, offset })
      .then((res) => {
        if (id !== requestId.current) return;
        setResponse(res);
        setResults((prev) => [...prev, ...res.results]);
      })
      .catch(() => {
        if (id === requestId.current) setLoadMoreError(true);
      })
      .finally(() => {
        if (id === requestId.current) loadingMore.current = false;
      });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { response, results, loading, error, loadMoreError, loadMore, retry };
}
