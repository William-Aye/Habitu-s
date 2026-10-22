import { useCallback, useEffect, useRef, useState } from 'react';
import { embedQuery, searchExplore } from './api';
import type { ExploreParams, ExploreResponse, ExploreResult } from './types';
import { normaliseQuery } from './types';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

// One embedding request per distinct normalised query, for the app session.
const embeddings = new Map<string, Promise<number[] | null>>();
function getEmbedding(normalised: string): Promise<number[] | null> {
  if (!normalised) return Promise.resolve(null);
  let p = embeddings.get(normalised);
  if (!p) {
    p = embedQuery(normalised);
    embeddings.set(normalised, p);
  }
  return p;
}

export function useExploreSearch(params: ExploreParams | null): {
  response: ExploreResponse | null;
  results: ExploreResult[];
  loading: boolean;
  error: boolean;
  loadMore(): void;
} {
  const normalised = params ? normaliseQuery(params.query) : '';
  const [debounced, setDebounced] = useState(normalised);
  const [response, setResponse] = useState<ExploreResponse | null>(null);
  const [results, setResults] = useState<ExploreResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const current = useRef<{ params: ExploreParams; embedding: number[] | null } | null>(null);
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
      return;
    }
    const effective = { ...p, query: debounced };
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const embedding = await getEmbedding(debounced);
        if (id !== requestId.current) return;
        const res = await searchExplore(effective, { limit: PAGE_SIZE, offset: 0 }, embedding);
        if (id !== requestId.current) return;
        current.current = { params: effective, embedding };
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
    const id = requestId.current;
    const offset = resultsRef.current.length;
    searchExplore(cur.params, { limit: PAGE_SIZE, offset }, cur.embedding)
      .then((res) => {
        if (id !== requestId.current) return;
        setResponse(res);
        setResults((prev) => [...prev, ...res.results]);
      })
      .catch(() => {
        if (id === requestId.current) setError(true);
      })
      .finally(() => {
        if (id === requestId.current) loadingMore.current = false;
      });
  }, []);

  return { response, results, loading, error, loadMore };
}
