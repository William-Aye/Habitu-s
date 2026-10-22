import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExploreKind, ExploreParams, Radius, Weekday } from '../types';

export type FilterState = Pick<ExploreParams, 'kinds' | 'weekday' | 'radiusKm' | 'newcomerFriendly'>;

const RADII: Radius[] = [5, 10, 25, 50];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Day and newcomer filters only apply to activities. */
export function activitiesOnly(p: Pick<FilterState, 'weekday' | 'newcomerFriendly'>): boolean {
  return p.weekday !== null || p.newcomerFriendly;
}

export function effectiveKinds(p: FilterState): ExploreKind[] {
  return activitiesOnly(p) ? ['activity'] : p.kinds;
}

function Chip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn, disabled && styles.chipOff]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Sheet({
  title,
  options,
  onSelect,
  onClose,
}: {
  title: string;
  options: { key: string; label: string; selected: boolean }[];
  onSelect(key: string): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('explore.filters.close')}
              onPress={onClose}
              style={styles.close}
            >
              <X size={18} color="#222" />
              <Text style={styles.chipText}>{t('explore.filters.close')}</Text>
            </Pressable>
          </View>
          {options.map((o) => (
            <Pressable
              key={o.key}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: o.selected }}
              onPress={() => onSelect(o.key)}
              style={styles.option}
            >
              <Text style={styles.optionText}>{o.label}</Text>
              {o.selected ? <Check size={18} color="#1a56db" /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

export function FilterChips({
  params,
  onChange,
}: {
  params: FilterState;
  onChange(patch: Partial<FilterState>): void;
}) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<'day' | 'distance' | null>(null);
  const restricted = activitiesOnly(params);
  const kinds = effectiveKinds(params);

  const toggleKind = (kind: ExploreKind) => {
    const has = params.kinds.includes(kind);
    if (has && params.kinds.length === 1) return; // never both off
    onChange({
      kinds: has
        ? params.kinds.filter((k) => k !== kind)
        : (['activity', 'association'] as ExploreKind[]).filter(
            (k) => k === kind || params.kinds.includes(k),
          ),
    });
  };

  const dayLabel = params.weekday ? t(`explore.days.${params.weekday}`) : t('explore.filters.day');
  const distanceLabel =
    params.radiusKm === 10
      ? t('explore.filters.distance')
      : t('explore.distance', { value: params.radiusKm });

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Chip
          label={t('explore.filters.activities')}
          selected={kinds.includes('activity')}
          onPress={() => toggleKind('activity')}
        />
        <Chip
          label={t('explore.filters.associations')}
          selected={kinds.includes('association')}
          disabled={restricted}
          onPress={() => toggleKind('association')}
        />
        <Chip label={dayLabel} selected={params.weekday !== null} onPress={() => setSheet('day')} />
        <Chip
          label={distanceLabel}
          selected={params.radiusKm !== 10}
          onPress={() => setSheet('distance')}
        />
        <Chip
          label={t('explore.filters.newcomers')}
          selected={params.newcomerFriendly}
          onPress={() => onChange({ newcomerFriendly: !params.newcomerFriendly })}
        />
      </ScrollView>
      {restricted ? <Text style={styles.hint}>{t('explore.activitiesOnly')}</Text> : null}
      {sheet === 'day' ? (
        <Sheet
          title={t('explore.filters.dayTitle')}
          onClose={() => setSheet(null)}
          onSelect={(k) => {
            onChange({ weekday: k === 'all' ? null : (Number(k) as Weekday) });
            setSheet(null);
          }}
          options={[
            { key: 'all', label: t('explore.days.all'), selected: params.weekday === null },
            ...WEEKDAYS.map((d) => ({
              key: String(d),
              label: t(`explore.days.${d}`),
              selected: params.weekday === d,
            })),
          ]}
        />
      ) : null}
      {sheet === 'distance' ? (
        <Sheet
          title={t('explore.filters.distanceTitle')}
          onClose={() => setSheet(null)}
          onSelect={(k) => {
            onChange({ radiusKm: Number(k) as Radius });
            setSheet(null);
          }}
          options={RADII.map((r) => ({
            key: String(r),
            label: t('explore.distance', { value: r }),
            selected: params.radiusKm === r,
          }))}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 8 },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  chipOff: { opacity: 0.5 },
  chipText: { fontSize: 14, color: '#222' },
  chipTextOn: { color: '#fff' },
  hint: { fontSize: 12, color: '#555', paddingBottom: 4 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '600' },
  close: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: { fontSize: 16 },
});
