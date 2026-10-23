import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decideClub, listClubs, searchAssociations, type AdminClub, type AssociationHit } from './api';
import { adminStyles as s, AdminButton, ErrorText, QueueState, useQueue } from './ui';

function AssociationPicker({ excludeId, value, onChange }: { excludeId: string; value: AssociationHit | null; onChange: (a: AssociationHit | null) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<AssociationHit[]>([]);
  useEffect(() => {
    let active = true;
    void searchAssociations(text).then((r) => active && setHits(r.ok ? r.items.filter((a) => a.id !== excludeId) : []));
    return () => {
      active = false;
    };
  }, [text, excludeId]);
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        accessibilityLabel={t('admin.clubs.search')}
        placeholder={t('admin.clubs.search')}
        style={s.input}
        value={text}
        onChangeText={(v) => {
          setText(v);
          onChange(null);
        }}
      />
      {hits.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="radio"
          accessibilityLabel={a.city ? `${a.name}, ${a.city}` : a.name}
          accessibilityState={{ selected: value?.id === a.id }}
          style={[s.choice, value?.id === a.id && s.chosen]}
          onPress={() => onChange(a)}
        >
          <Text>{a.city ? `${a.name} (${a.city})` : a.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ClubCard({
  club,
  busy,
  anyBusy,
  onDecide,
}: {
  club: AdminClub;
  busy: boolean;
  anyBusy: boolean;
  onDecide: (action: 'approve' | 'merge' | 'reject', opts?: { into?: string; note?: string }) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'merge' | 'reject' | null>(null);
  const [target, setTarget] = useState<AssociationHit | null>(null);
  const [note, setNote] = useState('');
  const noteBad = note.trim().length > 0 && note.trim().length < 10;
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{club.name}</Text>
      {club.city ? <Text style={s.meta}>{club.city}</Text> : null}
      {club.purpose ? <Text>{club.purpose}</Text> : null}
      <Text style={s.meta}>
        {t('admin.clubs.by', { prenom: club.createdByFirstName ?? t('admin.unknownPerson') })}
        {' - '}
        {t('admin.clubs.activities', { count: club.activityCount })}
      </Text>
      {mode === 'merge' ? (
        <>
          <Text style={s.label}>{t('admin.clubs.mergeInto')}</Text>
          <AssociationPicker excludeId={club.id} value={target} onChange={setTarget} />
          <View style={s.row}>
            <AdminButton
              variant="primary"
              label={t('admin.clubs.mergeConfirm')}
              busy={busy}
              disabled={!target || anyBusy}
              onPress={() => target && onDecide('merge', { into: target.id })}
            />
            <AdminButton label={t('admin.cancel')} disabled={anyBusy} onPress={() => setMode(null)} />
          </View>
        </>
      ) : mode === 'reject' ? (
        <>
          <TextInput
            accessibilityLabel={t('admin.clubs.rejectNote')}
            placeholder={t('admin.clubs.rejectNote')}
            style={[s.input, s.multiline]}
            multiline
            maxLength={1000}
            value={note}
            onChangeText={setNote}
          />
          <Text style={s.meta}>{t('admin.clubs.rejectHelp')}</Text>
          <View style={s.row}>
            <AdminButton
              variant="danger"
              label={t('admin.clubs.rejectConfirm')}
              busy={busy}
              disabled={noteBad || anyBusy}
              onPress={() => onDecide('reject', { note })}
            />
            <AdminButton label={t('admin.cancel')} disabled={anyBusy} onPress={() => setMode(null)} />
          </View>
        </>
      ) : (
        <View style={s.row}>
          <AdminButton variant="primary" label={t('admin.approve')} busy={busy} disabled={anyBusy} onPress={() => onDecide('approve')} />
          <AdminButton label={t('admin.clubs.merge')} disabled={anyBusy} onPress={() => setMode('merge')} />
          <AdminButton label={t('admin.reject')} disabled={anyBusy} onPress={() => setMode('reject')} />
        </View>
      )}
    </View>
  );
}

export function ClubsQueue() {
  const { t } = useTranslation();
  const q = useQueue<AdminClub>(listClubs);
  return (
    <>
      <ErrorText code={q.error} />
      <QueueState load={q.load} empty={t('admin.clubs.empty')} onRetry={q.reload}>
        {(items) =>
          items.map((c) => (
            <ClubCard
              key={c.id}
              club={c}
              busy={q.busyId === c.id}
              anyBusy={!!q.busyId}
              onDecide={(action, opts) => void q.act(c.id, () => decideClub(c.id, action, opts))}
            />
          ))
        }
      </QueueState>
    </>
  );
}
