import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { MapPin, ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { currentCommune } from '../../account/homeArea';
import { LocationPicker } from '../../explore/components/LocationPicker';
import { ATTRIBUTION, MAP_STYLE_URL } from '../../explore/map';
import type { Town } from '../../explore/types';
import { PLACE_LABEL_MAX } from '../form';
import { stepStyles as s, type StepProps } from './styles';

const ZOOM = 14;

/** The meeting place: start from a town, then touch the map to put the pin on the exact spot. */
export function WhereStep({ form, set }: StepProps) {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);

  const pickTown = (town: Town) => {
    set({ pin: { lon: town.lon, lat: town.lat }, townLabel: town.label });
    setChanging(false);
  };
  const useGps = async (): Promise<'ok' | 'denied'> => {
    const area = await currentCommune();
    if (area === 'denied') return 'denied';
    pickTown(area);
    return 'ok';
  };

  return (
    <View style={s.container}>
      <View style={styles.tip} accessibilityRole="summary">
        <ShieldAlert size={20} color="#92400e" />
        <Text style={styles.tipText}>{t('create.where.homeTip')}</Text>
      </View>

      {form.pin && !changing ? (
        <>
          <View style={s.row}>
            <Text style={s.heading}>{t('create.where.near', { town: form.townLabel })}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('create.where.changeTown')}
              onPress={() => setChanging(true)}
            >
              <Text style={s.outlineText}>{t('create.where.changeTown')}</Text>
            </Pressable>
          </View>
          <Text style={s.hint}>{t('create.where.mapHint')}</Text>
          <Map
            mapStyle={MAP_STYLE_URL}
            attribution
            accessibilityLabel={t('create.where.mapLabel')}
            style={styles.map}
            onPress={(e) => {
              const [lon, lat] = e.nativeEvent.lngLat;
              set({ pin: { lon, lat } });
            }}
          >
            <Camera center={[form.pin.lon, form.pin.lat]} zoom={ZOOM} />
            <Marker id="pin" lngLat={[form.pin.lon, form.pin.lat]}>
              <MapPin size={32} color="#c2410c" />
            </Marker>
          </Map>
          <Text style={styles.attribution}>{ATTRIBUTION}</Text>
          <Text style={s.label}>{t('create.where.placeLabel')}</Text>
          <TextInput
            style={s.input}
            value={form.placeLabel}
            onChangeText={(placeLabel) => set({ placeLabel })}
            maxLength={PLACE_LABEL_MAX}
            placeholder={t('create.where.placePlaceholder')}
            accessibilityLabel={t('create.where.placeLabel')}
          />
        </>
      ) : (
        <LocationPicker onGps={useGps} onTown={pickTown} onCancel={form.pin ? () => setChanging(false) : undefined} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fef3c7',
  },
  tipText: { flex: 1, fontSize: 14, color: '#92400e' },
  map: { height: 260, borderRadius: 12, overflow: 'hidden' },
  attribution: { fontSize: 11, color: '#555' },
});
