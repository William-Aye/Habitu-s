import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { resolveHomeArea } from '../account/homeArea';
import { roundKm } from './round';
import type { StoredLocation, Town } from './types';

const KEY = 'explore.location';

// Told when the stored location was wiped (account deletion) so mounted hooks drop their copy.
const resetListeners = new Set<() => void>();
export function subscribeExploreLocationReset(fn: () => void): () => void {
  resetListeners.add(fn);
  return () => {
    resetListeners.delete(fn);
  };
}
export function notifyExploreLocationReset(): void {
  resetListeners.forEach((fn) => fn());
}
export const MY_POSITION_KEY = 'explore.location.myPosition';

export function useExploreLocation(): {
  location: StoredLocation | null;
  status: 'loading' | 'ready' | 'needed';
  /** With `toCommune`, the position is stored as its commune centre; if that lookup fails nothing is stored and 'denied' is returned. */
  requestGps(opts?: { toCommune?: boolean }): Promise<'ok' | 'denied'>;
  setTown(t: Town): Promise<void>;
} {
  const [location, setLocation] = useState<StoredLocation | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => subscribeExploreLocationReset(() => setLocation(null)), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const v = raw ? (JSON.parse(raw) as StoredLocation) : null;
        if (!cancelled && v && typeof v.lon === 'number' && typeof v.lat === 'number') {
          // A position stored before rounding existed is coarsened on load.
          setLocation(v.source === 'gps' ? { ...v, lon: roundKm(v.lon), lat: roundKm(v.lat) } : v);
        }
      } catch {
        // unreadable storage: treat as no location
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (v: StoredLocation) => {
    setLocation(v);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      // keep in-memory value
    }
  }, []);

  const requestGps = useCallback(async (opts?: { toCommune?: boolean }): Promise<'ok' | 'denied'> => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return 'denied';
      const pos = await Location.getCurrentPositionAsync({});
      // Rounded to ~1 km before anything leaves the device (commune lookup included).
      const lon = roundKm(pos.coords.longitude);
      const lat = roundKm(pos.coords.latitude);
      if (opts?.toCommune) {
        const area = await resolveHomeArea({ label: MY_POSITION_KEY, lon, lat, source: 'gps' });
        if (!area) return 'denied';
        await save({ ...area, source: 'town' });
        return 'ok';
      }
      await save({ label: MY_POSITION_KEY, lon, lat, source: 'gps' });
      return 'ok';
    } catch {
      return 'denied';
    }
  }, [save]);

  const setTown = useCallback(
    (t: Town) => save({ label: t.label, lon: t.lon, lat: t.lat, source: 'town' }),
    [save],
  );

  return {
    location,
    status: !loaded ? 'loading' : location ? 'ready' : 'needed',
    requestGps,
    setTown,
  };
}
