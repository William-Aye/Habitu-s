import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { stepStyles as s, type StepProps } from './styles';

const MODES = ['open', 'approval'] as const;

export function SettingsStep({ form, set }: StepProps) {
  const { t } = useTranslation();
  return (
    <View style={s.container}>
      <Text style={s.label}>{t('create.settings.maxSize')}</Text>
      <TextInput
        style={s.input}
        value={form.maxSize}
        onChangeText={(maxSize) => set({ maxSize })}
        keyboardType="number-pad"
        maxLength={3}
        accessibilityLabel={t('create.settings.maxSize')}
        accessibilityHint={t('create.settings.maxSizeHint')}
      />
      <Text style={s.hint}>{t('create.settings.maxSizeHint')}</Text>

      <View style={s.row}>
        <Switch
          value={form.newcomerFriendly}
          onValueChange={(newcomerFriendly) => set({ newcomerFriendly })}
          accessibilityLabel={t('create.settings.newcomers')}
        />
        <Text style={s.optionText}>{t('create.settings.newcomers')}</Text>
      </View>

      <Text style={s.label}>{t('create.settings.access')}</Text>
      <View style={s.wrap} accessibilityRole="radiogroup">
        {MODES.map((mode) => {
          const on = form.approvalMode === mode;
          const label = t(`create.settings.${mode}`);
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              style={[s.option, on && s.optionOn]}
              onPress={() => set({ approvalMode: mode })}
            >
              <Text style={[s.optionText, on && s.optionTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
