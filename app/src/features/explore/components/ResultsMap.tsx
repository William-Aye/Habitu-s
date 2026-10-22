import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ATTRIBUTION, MAP_STYLE_URL, boundsAround } from '../map';
import type { ExploreResult, Radius } from '../types';
import { ResultCard } from './ResultCard';

interface Props {
  results: ExploreResult[];
  center: { lon: number; lat: number };
  radiusKm: Radius;
  onOpen(result: ExploreResult): void;
}

export function ResultsMap({ results, center, radiusKm, onOpen }: Props) {
  const [selected, setSelected] = useState<ExploreResult | null>(null);
  return (
    <View style={styles.container}>
      <View style={styles.map}>
        <Map mapStyle={MAP_STYLE_URL} attribution onPress={() => setSelected(null)} style={styles.map}>
          <Camera bounds={boundsAround(center, radiusKm)} padding={{ top: 24, right: 24, bottom: 24, left: 24 }} />
          {results.map((r) => {
            // By identity of the row, not the object: a new page or refetch brings new objects.
            const on = selected?.kind === r.kind && selected.id === r.id;
            return (
              <Marker
                key={`${r.kind}-${r.id}`}
                id={`${r.kind}-${r.id}`}
                lngLat={[r.lon, r.lat]}
                accessibilityLabel={r.title}
                accessibilityState={{ selected: on }}
                onPress={() => setSelected(r)}
              >
                <MapPin size={28} color={on ? '#1a56db' : '#c2410c'} />
              </Marker>
            );
          })}
        </Map>
      </View>
      {selected ? (
        <View testID="map-card" style={styles.card}>
          <ResultCard result={selected} onPress={() => onOpen(selected)} />
        </View>
      ) : null}
      <Text style={styles.attribution}>{ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  card: { paddingHorizontal: 12, backgroundColor: '#fff' },
  attribution: { fontSize: 11, color: '#555', paddingVertical: 4 },
});
