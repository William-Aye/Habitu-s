import { Check } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../account/useSession';
import { myCollectifs } from '../../collectifs/api';
import { CreateCollectifForm } from '../../collectifs/CreateCollectifForm';
import { addCommunityAssociation, searchLinkableAssociations, type LinkableAssociation } from '../associationDirectory';
import type { ApiError, MyCollectif } from '../types';
import { stepStyles as s, type StepProps } from './styles';

const SEARCH_DEBOUNCE_MS = 300;

function Option({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[s.option, s.row, selected && s.optionOn]}
      onPress={onPress}
    >
      {selected ? <Check size={18} color="#1a3a9e" /> : null}
      <View>
        <Text style={[s.optionText, selected && s.optionTextOn]}>{label}</Text>
        {detail ? <Text style={s.hint}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

function CollectifChoice({ form, set }: StepProps) {
  const { t } = useTranslation();
  const [list, setList] = useState<MyCollectif[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    myCollectifs().then((r) => {
      if (r.ok) setList(r.collectifs);
      else setFailed(true);
    });
  }, []);
  useEffect(load, [load]);

  if (failed) {
    return (
      <View style={s.container}>
        <Text style={s.error}>{t('create.who.collectifError')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('create.retry')} style={s.outline}
          onPress={() => {
            setFailed(false);
            load();
          }}
        >
          <Text style={s.outlineText}>{t('create.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!list) return <ActivityIndicator accessibilityLabel={t('create.loading')} />;

  return (
    <View style={s.container}>
      <Text style={s.hint}>{t('create.who.collectifLabel')}</Text>
      {list.length === 0 && !creating ? <Text>{t('create.who.collectifNone')}</Text> : null}
      {list.map((c) => (
        <Option
          key={c.id}
          label={c.name}
          detail={c.townLabel}
          selected={form.collectifId === c.id}
          onPress={() => set({ collectifId: c.id })}
        />
      ))}
      {creating ? (
        <CreateCollectifForm
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setList((prev) => [...(prev ?? []), created]);
            set({ collectifId: created.id });
            setCreating(false);
          }}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('create.who.createCollectif')}
          style={s.outline}
          onPress={() => setCreating(true)}
        >
          <Text style={s.outlineText}>{t('create.who.createCollectif')}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A club missing from the directory: the community path (listing labelled "Ajouté par la communauté"). */
function AddClubForm({ onAdded, onCancel }: { onAdded(a: { id: string; name: string }): void; onCancel(): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const valid = name.trim().length >= 2;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const result = await addCommunityAssociation({ name, website });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onAdded({ id: result.id, name: name.trim() });
  };

  return (
    <View style={s.container}>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        maxLength={120}
        placeholder={t('create.who.clubName')}
        accessibilityLabel={t('create.who.clubName')}
      />
      <TextInput
        style={s.input}
        value={website}
        onChangeText={setWebsite}
        autoCapitalize="none"
        placeholder={t('create.who.clubWebsite')}
        accessibilityLabel={t('create.who.clubWebsite')}
      />
      <Text style={s.hint}>{t('create.who.clubHint')}</Text>
      {error ? <Text style={s.error}>{t('create.who.clubError')}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('create.who.clubSubmit')}
        accessibilityState={{ disabled: !valid || busy }}
        disabled={!valid || busy}
        style={[s.button, (!valid || busy) && s.disabled]}
        onPress={submit}
      >
        <Text style={s.buttonText}>{t('create.who.clubSubmit')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('create.who.clubCancel')} style={s.outline} onPress={onCancel}>
        <Text style={s.outlineText}>{t('create.who.clubCancel')}</Text>
      </Pressable>
    </View>
  );
}

function AssociationChoice({ form, set }: StepProps) {
  const { t } = useTranslation();
  const { userId } = useSession();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LinkableAssociation[]>([]);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2 || !userId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchLinkableAssociations(query, userId)
        .then((r) => {
          if (cancelled) return;
          setFailed(false);
          setResults(r);
        })
        .catch(() => !cancelled && setFailed(true));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, userId]);

  if (adding) {
    return (
      <AddClubForm
        onCancel={() => setAdding(false)}
        onAdded={(club) => {
          set({ association: club });
          setAdding(false);
        }}
      />
    );
  }
  const shown = query.length >= 2 ? results : [];
  return (
    <View style={s.container}>
      <TextInput
        style={s.input}
        value={q}
        onChangeText={setQ}
        placeholder={t('create.who.associationSearch')}
        accessibilityLabel={t('create.who.associationSearch')}
      />
      <Text style={s.hint}>{t('create.who.associationRule')}</Text>
      {form.association && !shown.some((a) => a.id === form.association?.id) ? (
        <Option label={form.association.name} selected onPress={() => {}} />
      ) : null}
      {shown.map((a) => (
        <Option
          key={a.id}
          label={a.name}
          detail={a.address ?? undefined}
          selected={form.association?.id === a.id}
          onPress={() => set({ association: { id: a.id, name: a.name } })}
        />
      ))}
      {failed ? <Text style={s.error}>{t('create.who.associationError')}</Text> : null}
      {query.length >= 2 && !failed && shown.length === 0 ? <Text>{t('create.who.associationNone')}</Text> : null}
      <Text>{t('create.who.unlisted')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('create.who.addClub')}
        style={s.outline}
        onPress={() => setAdding(true)}
      >
        <Text style={s.outlineText}>{t('create.who.addClub')}</Text>
      </Pressable>
    </View>
  );
}

export function WhoStep({ form, set }: StepProps) {
  const { t } = useTranslation();
  return (
    <View style={s.container} accessibilityRole="radiogroup">
      <Option label={t('create.who.me')} detail={t('create.who.meHint')} selected={form.who === 'me'} onPress={() => set({ who: 'me' })} />
      <Option
        label={t('create.who.collectif')}
        selected={form.who === 'collectif'}
        onPress={() => set({ who: 'collectif' })}
      />
      {form.who === 'collectif' ? <CollectifChoice form={form} set={set} /> : null}
      <Option
        label={t('create.who.association')}
        selected={form.who === 'association'}
        onPress={() => set({ who: 'association' })}
      />
      {form.who === 'association' ? <AssociationChoice form={form} set={set} /> : null}
    </View>
  );
}
