import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { hasChildren } from '../form';
import { stepStyles as s, type StepProps } from './styles';

const MODES = ['open', 'approval'] as const;
const HISTORIES = ['all', 'since_join'] as const;

export function SettingsStep({ form, set }: StepProps) {
  const { t } = useTranslation();
  const children = hasChildren(form);
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

      <View style={s.row}>
        <Switch
          value={children}
          disabled={form.familyCategory}
          onValueChange={(withChildren) => set({ withChildren })}
          accessibilityLabel={t('create.settings.children')}
        />
        <Text style={s.optionText}>{t('create.settings.children')}</Text>
      </View>
      {form.familyCategory ? <Text style={s.hint}>{t('create.settings.childrenFamily')}</Text> : null}
      {children && !form.familyCategory ? <Text style={s.hint}>{t('create.what.noAddress')}</Text> : null}

      <Text style={s.label}>{t('create.settings.access')}</Text>
      <View style={s.wrap} accessibilityRole="radiogroup">
        {MODES.map((mode) => {
          // With children the choice is fixed: every request is accepted by the organiser.
          const on = (children ? 'approval' : form.approvalMode) === mode;
          const label = t(`create.settings.${mode}`);
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: on, disabled: children }}
              disabled={children}
              style={[s.option, on && s.optionOn, children && s.disabled]}
              onPress={() => set({ approvalMode: mode })}
            >
              <Text style={[s.optionText, on && s.optionTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {children ? <Text style={s.hint}>{t('create.settings.childrenApproval')}</Text> : null}

      <Text style={s.label}>{t('create.settings.history')}</Text>
      <View style={s.wrap} accessibilityRole="radiogroup">
        {HISTORIES.map((h) => {
          const on = form.chatHistory === h;
          const label = t(`create.settings.history_${h}`);
          return (
            <Pressable
              key={h}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              style={[s.option, on && s.optionOn]}
              onPress={() => set({ chatHistory: h })}
            >
              <Text style={[s.optionText, on && s.optionTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
