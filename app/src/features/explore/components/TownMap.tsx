import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { ATTRIBUTION, MAP_STYLE_URL, kmToPixels } from '../map';

const ZOOM = 12;
const TOWN_RADIUS_KM = 1;

interface Props {
  lon: number;
  lat: number;
  label: string;
}

/** Town-level map: a ~1 km translucent disc instead of a pin, not interactive. */
export function TownMap({ lon, lat, label }: Props) {
  const point: GeoJSON.Feature<GeoJSON.Point> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
  return (
    <View>
      <Map
        mapStyle={MAP_STYLE_URL}
        attribution
        accessibilityLabel={label}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        style={styles.map}
      >
        <Camera center={[lon, lat]} zoom={ZOOM} />
        <GeoJSONSource id="town" data={point}>
          <Layer
            id="town-area"
            type="circle"
            paint={{
              'circle-radius': kmToPixels(TOWN_RADIUS_KM, ZOOM, lat),
              'circle-color': '#1a56db',
              'circle-opacity': 0.25,
              'circle-stroke-color': '#1a56db',
              'circle-stroke-width': 1,
            }}
          />
        </GeoJSONSource>
      </Map>
      <Text style={styles.attribution}>{ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 180, borderRadius: 12, overflow: 'hidden' },
  attribution: { fontSize: 11, color: '#555', paddingVertical: 4 },
});
