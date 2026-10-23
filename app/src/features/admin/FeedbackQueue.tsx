import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { feedbackScreenshotUrl, listFeedback, setFeedbackStatus, type AdminError, type AdminFeedback, type FeedbackStatus } from './api';
import { adminStyles as s, AdminButton, ErrorText, QueueState, useQueue } from './ui';

const STATUSES: FeedbackStatus[] = ['planned', 'done', 'wont_do'];

export function FeedbackQueue() {
  const { t } = useTranslation();
  const q = useQueue<AdminFeedback>(listFeedback);
  const [shotBusy, setShotBusy] = useState(false);
  const [shotError, setShotError] = useState<AdminError | null>(null);

  const openShot = async (id: string) => {
    if (shotBusy) return;
    setShotBusy(true);
    setShotError(null);
    const r = await feedbackScreenshotUrl(id);
    setShotBusy(false);
    if (!r.ok) {
      if (r.error === 'not_allowed') return q.lock();
      return setShotError(r.error);
    }
    try {
      await Linking.openURL(r.url);
    } catch {
      setShotError('unknown');
    }
  };

  return (
    <>
      <ErrorText code={q.error ?? shotError} />
      <QueueState load={q.load} empty={t('admin.feedback.empty')} onRetry={q.reload}>
        {(items) =>
          items.map((f) => (
            <View key={f.id} style={s.card}>
              <Text style={s.cardTitle}>{t(`admin.feedback.types.${f.type}`, { defaultValue: f.type })}</Text>
              <Text style={s.meta}>{t('admin.feedback.from', { prenom: f.senderFirstName ?? t('admin.feedback.anonymous') })}</Text>
              <Text>{f.body}</Text>
              {f.hasScreenshot ? (
                <AdminButton label={t('admin.feedback.screenshot')} busy={shotBusy} onPress={() => void openShot(f.id)} />
              ) : null}
              <View style={s.row}>
                {STATUSES.map((st) => (
                  <AdminButton
                    key={st}
                    label={t(`admin.feedback.statuses.${st}`)}
                    busy={q.busyId === f.id}
                    disabled={!!q.busyId}
                    onPress={() => void q.act(f.id, () => setFeedbackStatus(f.id, st))}
                  />
                ))}
              </View>
            </View>
          ))
        }
      </QueueState>
    </>
  );
}
