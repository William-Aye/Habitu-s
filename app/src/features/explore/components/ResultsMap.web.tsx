import { MapPin } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExploreResult, Radius } from '../types';

interface Props {
  results: ExploreResult[];
  center: { lon: number; lat: number };
  radiusKm: Radius;
  onOpen(result: ExploreResult): void;
}

/** No map on the web: a link to OpenStreetMap centred on the search area. */
export function ResultsMap({ center }: Props) {
  const { t } = useTranslation();
  const url = `https://www.openstreetmap.org/?mlat=${center.lat}&mlon=${center.lon}#map=12/${center.lat}/${center.lon}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('activity.mapLink')}
      style={styles.link}
      onPress={() => void Linking.openURL(url)}
    >
      <MapPin size={18} color="#1a56db" />
      <Text style={styles.text}>{t('activity.mapLink')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, padding: 12 },
  text: { color: '#1a56db', fontWeight: '600' },
});
