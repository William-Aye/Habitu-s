import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import type { StoredLocation, Town } from './types';

const KEY = 'explore.location';

/** GPS is kept and sent to search only at ~1 km precision (0.01 degree). */
function roundKm(v: number): number {
  return Math.round(v * 100) / 100;
}
export const MY_POSITION_KEY = 'explore.location.myPosition';

export function useExploreLocation(): {
  location: StoredLocation | null;
  status: 'loading' | 'ready' | 'needed';
  requestGps(): Promise<'ok' | 'denied'>;
  setTown(t: Town): Promise<void>;
} {
  const [location, setLocation] = useState<StoredLocation | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const v = raw ? (JSON.parse(raw) as StoredLocation) : null;
        if (!cancelled && v && typeof v.lon === 'number' && typeof v.lat === 'number') {
          setLocation(v);
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

  const requestGps = useCallback(async (): Promise<'ok' | 'denied'> => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return 'denied';
      const pos = await Location.getCurrentPositionAsync({});
      await save({
        label: MY_POSITION_KEY,
        lon: roundKm(pos.coords.longitude),
        lat: roundKm(pos.coords.latitude),
        source: 'gps',
      });
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
