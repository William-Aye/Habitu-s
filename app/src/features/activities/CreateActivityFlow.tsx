import { router } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createActivity } from './api';
import { STEP_COUNT, initialForm, stepValid, toDraft, type FormState } from './form';
import { shareActivity } from './share';
import { SettingsStep } from './steps/SettingsStep';
import { stepStyles as s } from './steps/styles';
import { WhatStep } from './steps/WhatStep';
import { WhenStep } from './steps/WhenStep';
import { WhereStep } from './steps/WhereStep';
import { WhoStep } from './steps/WhoStep';
import type { ApiError } from './types';

const STEP_KEYS = ['who', 'what', 'where', 'when', 'settings'] as const;
const STEPS = [WhoStep, WhatStep, WhereStep, WhenStep, SettingsStep];

export function CreateActivityFlow({ initialCollectifId }: { initialCollectifId?: string }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() => initialForm(initialCollectifId));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  const set = useCallback((patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch })), []);

  if (created) {
    return (
      <View style={styles.page}>
        <Text accessibilityRole="header" style={styles.title}>{t('create.done.title')}</Text>
        <Text>{t('create.done.body', { title: created.title })}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('create.done.share')}
          style={[s.button, styles.inline]}
          onPress={() => {
            // The share sheet closing without a choice is not an error.
            shareActivity(created.id, created.title).catch(() => {});
          }}
        >
          <Share2 size={18} color="#fff" />
          <Text style={s.buttonText}>{t('create.done.share')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('create.done.view')}
          style={s.outline}
          onPress={() =>
            router.replace({ pathname: '/activites/[id]', params: { id: created.id, title: created.title } })
          }
        >
          <Text style={s.outlineText}>{t('create.done.view')}</Text>
        </Pressable>
      </View>
    );
  }

  const last = step === STEP_COUNT - 1;
  const valid = stepValid(step, form);
  const Step = STEPS[step];

  const publish = async () => {
    const draft = toDraft(form);
    if (!draft || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await createActivity(draft);
    busyRef.current = false;
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCreated({ id: result.id, title: draft.title });
  };

  const go = (to: number) => {
    setError(null);
    setStep(to);
  };

  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>{t('create.title')}</Text>
      <Text accessibilityLiveRegion="polite" style={s.hint}>
        {t('create.progress', { n: step + 1, total: STEP_COUNT })}
      </Text>
      <Text accessibilityRole="header" style={s.heading}>{t(`create.steps.${STEP_KEYS[step]}`)}</Text>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Step form={form} set={set} />
        {error ? (
          <Text accessibilityLiveRegion="polite" style={s.error}>
            {t(`create.errors.${error}`)}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {step > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('create.back')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[s.outline, styles.footerButton, busy && s.disabled]}
            onPress={() => go(step - 1)}
          >
            <Text style={s.outlineText}>{t('create.back')}</Text>
          </Pressable>
        ) : null}
        {last ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('create.publish')}
            accessibilityState={{ disabled: !valid || busy, busy }}
            disabled={!valid || busy}
            style={[s.button, styles.footerButton, (!valid || busy) && s.disabled]}
            onPress={publish}
          >
            <Text style={s.buttonText}>{busy ? t('create.publishing') : t('create.publish')}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('create.next')}
            accessibilityState={{ disabled: !valid }}
            disabled={!valid}
            style={[s.button, styles.footerButton, !valid && s.disabled]}
            onPress={() => go(step + 1)}
          >
            <Text style={s.buttonText}>{t('create.next')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 16, paddingTop: 56, gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { flex: 1 },
  bodyContent: { paddingVertical: 12, paddingBottom: 24 },
  footer: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  footerButton: { flex: 1 },
  inline: { flexDirection: 'row', gap: 8 },
});
