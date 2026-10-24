import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { liftBan, listBannedUsers, type AdminError, type BannedPerson } from './api';
import { useAdminLock } from './MfaGate';
import { adminStyles as s, AdminButton, DoneNotice, ErrorText, useFailure } from './ui';

const MIN = 10;
const MAX = 1000;

/** Lets an admin end a suspension: find the person by first name, give the reason, lift. */
export function LiftBan() {
  const { t, i18n } = useTranslation();
  const lock = useAdminLock();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<BannedPerson[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<AdminError | null>(null);
  const inflight = useRef(false);
  const fail = useFailure(setError);

  useEffect(() => {
    let active = true;
    void listBannedUsers(query).then((r) => {
      if (!active) return;
      if (r.ok) return setPeople(r.items);
      setPeople([]);
      if (r.error === 'not_allowed') return void lock();
      setError(r.error);
    });
    return () => {
      active = false;
    };
  }, [query, lock]);

  const text = statement.trim();
  const ready = chosen !== null && text.length >= MIN && text.length <= MAX;
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR') : '';

  const lift = async () => {
    if (inflight.current || !chosen) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    setDone(false);
    const r = await liftBan(chosen, statement);
    inflight.current = false;
    setBusy(false);
    if (!r.ok) return void fail(r.error);
    setDone(true);
    setPeople((cur) => (cur ?? []).filter((p) => p.id !== chosen));
    setChosen(null);
    setStatement('');
  };

  return (
    <View style={s.card}>
      <Text style={s.meta}>{t('admin.liftBan.note')}</Text>
      <TextInput
        accessibilityLabel={t('admin.liftBan.search')}
        placeholder={t('admin.liftBan.search')}
        style={s.input}
        maxLength={50}
        autoCapitalize="none"
        value={query}
        editable={!busy}
        onChangeText={(v) => {
          setQuery(v);
          setChosen(null);
        }}
      />
      <ErrorText code={error} />
      <DoneNotice show={done} />
      {people && people.length === 0 ? <Text style={s.meta}>{t('admin.liftBan.empty')}</Text> : null}
      <View style={s.row}>
        {(people ?? []).map((p) => {
          const label = t('admin.liftBan.person', { prenom: p.firstName, date: date(p.bannedAt) });
          return (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: chosen === p.id, disabled: busy }}
              disabled={busy}
              style={[s.choice, chosen === p.id && s.chosen]}
              onPress={() => setChosen(p.id)}
            >
              <Text>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {chosen ? (
        <>
          <Text style={s.label}>{t('admin.liftBan.statement')}</Text>
          <TextInput
            accessibilityLabel={t('admin.liftBan.statement')}
            placeholder={t('admin.liftBan.statement')}
            style={[s.input, s.multiline]}
            multiline
            maxLength={MAX}
            value={statement}
            editable={!busy}
            onChangeText={setStatement}
          />
          <Text style={s.meta}>{t('admin.liftBan.statementHelp', { min: MIN, max: MAX })}</Text>
          <AdminButton variant="primary" label={t('admin.liftBan.action')} busy={busy} disabled={!ready} onPress={() => void lift()} />
        </>
      ) : null}
    </View>
  );
}
