import { useRef, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { claimDocumentUrl, decideClaim, listClaims, type AdminClaim, type AdminError } from './api';
import { adminStyles as s, AdminButton, DoneNotice, ErrorText, QueueState, useFailure, useQueue } from './ui';

export function ClaimsQueue() {
  const { t } = useTranslation();
  const q = useQueue<AdminClaim>(listClaims);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState<AdminError | null>(null);
  const inflight = useRef(false);
  const fail = useFailure(setDocError);

  const openDocument = async (id: string) => {
    if (inflight.current) return;
    inflight.current = true;
    setDocBusy(true);
    setDocError(null);
    const r = await claimDocumentUrl(id);
    setDocBusy(false);
    inflight.current = false;
    if (!r.ok) return fail(r.error);
    try {
      await Linking.openURL(r.url);
    } catch {
      setDocError('unknown');
    }
  };

  return (
    <>
      <ErrorText code={q.error ?? docError} />
      <DoneNotice show={q.done} />
      <QueueState load={q.load} empty={t('admin.claims.empty')} onRetry={q.reload}>
        {(items) =>
          items.map((c) => {
            const busy = q.busyId === c.id;
            const note = notes[c.id] ?? '';
            return (
              <View key={c.id} style={s.card}>
                <Text style={s.cardTitle}>{c.associationName}</Text>
                {c.city ? <Text style={s.meta}>{c.city}</Text> : null}
                <Text style={s.meta}>{t('admin.claims.claimant', { prenom: c.claimantFirstName ?? t('admin.unknownPerson') })}</Text>
                <Text>{t('admin.claims.role', { role: c.role })}</Text>
                {c.contactEmail ? <Text selectable>{t('admin.claims.email', { email: c.contactEmail })}</Text> : null}
                {c.hasDocument ? (
                  <AdminButton label={t('admin.claims.viewDocument')} busy={docBusy} onPress={() => void openDocument(c.id)} />
                ) : null}
                <TextInput
                  accessibilityLabel={t('admin.note')}
                  placeholder={t('admin.note')}
                  style={s.input}
                  maxLength={1000}
                  value={note}
                  editable={!q.busyId}
                  onChangeText={(v) => setNotes((cur) => ({ ...cur, [c.id]: v }))}
                />
                <View style={s.row}>
                  <AdminButton
                    variant="primary"
                    label={t('admin.approve')}
                    busy={busy}
                    disabled={!!q.busyId}
                    onPress={() => void q.act(c.id, () => decideClaim(c.id, true, note))}
                  />
                  <AdminButton
                    label={t('admin.reject')}
                    busy={busy}
                    disabled={!!q.busyId}
                    onPress={() => void q.act(c.id, () => decideClaim(c.id, false, note))}
                  />
                </View>
              </View>
            );
          })
        }
      </QueueState>
    </>
  );
}
