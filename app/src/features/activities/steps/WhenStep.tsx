import { Text, TextInput, View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { recurrenceOf } from '../form';
import { describeRecurrence } from '../recurrence';
import type { Recurrence } from '../types';
import { stepStyles as s, type StepProps } from './styles';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const KINDS: Recurrence['kind'][] = ['weekly', 'every_n_days', 'weekdays'];

export function WhenStep({ form, set }: StepProps) {
  const { t } = useTranslation();
  const recurrence = recurrenceOf(form);
  const kindLabel = (kind: Recurrence['kind']) =>
    kind === 'weekly'
      ? t('activities.recurrence.weekly')
      : kind === 'every_n_days'
        ? t('activities.recurrence.everyNDays', { n: form.everyDays.trim() || '…' })
        : t('activities.recurrence.weekdays');

  return (
    <View style={s.container}>
      <Text style={s.label}>{t('create.when.date')}</Text>
      <TextInput
        style={s.input}
        value={form.startDate}
        onChangeText={(startDate) => set({ startDate })}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        accessibilityLabel={t('create.when.date')}
        accessibilityHint={t('create.when.dateHint')}
      />
      <Text style={s.hint}>{t('create.when.dateHint')}</Text>

      <Text style={s.label}>{t('create.when.time')}</Text>
      <TextInput
        style={s.input}
        value={form.startTime}
        onChangeText={(startTime) => set({ startTime })}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        accessibilityLabel={t('create.when.time')}
        accessibilityHint={t('create.when.timeHint')}
      />
      <Text style={s.hint}>{t('create.when.timeHint')}</Text>

      <Text style={s.label}>{t('create.when.recurrence')}</Text>
      <View style={s.wrap} accessibilityRole="radiogroup">
        {KINDS.map((kind) => {
          const on = form.recurrenceKind === kind;
          const label = kindLabel(kind);
          return (
            <Pressable
              key={kind}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              style={[s.option, on && s.optionOn]}
              onPress={() => set({ recurrenceKind: kind })}
            >
              <Text style={[s.optionText, on && s.optionTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {form.recurrenceKind === 'every_n_days' ? (
        <>
          <TextInput
            style={s.input}
            value={form.everyDays}
            onChangeText={(everyDays) => set({ everyDays })}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel={t('create.when.days')}
            accessibilityHint={t('create.when.daysHint')}
          />
          <Text style={s.hint}>{t('create.when.daysHint')}</Text>
        </>
      ) : null}

      {form.recurrenceKind === 'weekdays' ? (
        <>
          <Text style={s.label}>{t('create.when.weekdays')}</Text>
          <View style={s.wrap}>
            {WEEKDAYS.map((day) => {
              const on = form.weekdays.includes(day);
              const name = t(`create.when.weekday.${day}`);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityLabel={name}
                  accessibilityState={{ checked: on }}
                  style={[s.option, on && s.optionOn]}
                  onPress={() => set({ weekdays: on ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day] })}
                >
                  <Text style={[s.optionText, on && s.optionTextOn]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {recurrence ? (
        <Text style={s.hint}>
          {t('create.when.summary', {
            text: describeRecurrence(recurrence, form.startTime, t, { startDate: form.startDate }),
          })}
        </Text>
      ) : null}
    </View>
  );
}
