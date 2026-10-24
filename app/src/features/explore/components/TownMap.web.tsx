import { MapPin } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

interface Props {
  lon: number;
  lat: number;
  label: string;
}

/** No embedded map on the web (no third-party script): a link to OpenStreetMap, centred on the town. */
export function TownMap({ lon, lat, label }: Props) {
  const { t } = useTranslation();
  const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('activity.mapLink')}
      accessibilityHint={label}
      style={styles.link}
      onPress={() => void Linking.openURL(url)}
    >
      <MapPin size={18} color="#1a56db" />
      <Text style={styles.text}>{t('activity.mapLink')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  text: { color: '#1a56db', fontWeight: '600' },
});
