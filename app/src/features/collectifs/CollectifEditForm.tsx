import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { currentCommune } from '../account/homeArea';
import { stepStyles as s } from '../activities/steps/styles';
import type { ApiError, CollectifPage } from '../activities/types';
import { LocationPicker } from '../explore/components/LocationPicker';
import type { Town } from '../explore/types';
import { updateCollectif } from './api';
import { useCollectifErrorText } from './errors';

const NAME_MIN = 3;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

/** Inline editor for name, description and town; the town is only sent when it was changed. */
export function CollectifEditForm({
  collectif,
  onSaved,
  onCancel,
}: {
  collectif: CollectifPage;
  onSaved(): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const errorText = useCollectifErrorText();
  const [name, setName] = useState(collectif.name);
  const [description, setDescription] = useState(collectif.description ?? '');
  const [town, setTown] = useState<Town | null>(null);
  const [changingTown, setChangingTown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX && description.length <= DESCRIPTION_MAX;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const result = await updateCollectif(collectif.id, {
      name: trimmed,
      description: description.trim(),
      ...(town ? { town } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onSaved();
  };

  const useGps = async (): Promise<'ok' | 'denied'> => {
    const area = await currentCommune();
    if (area === 'denied') return 'denied';
    setTown(area);
    setChangingTown(false);
    return 'ok';
  };

  return (
    <View style={s.container}>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
        accessibilityLabel={t('create.collectifForm.name')}
      />
      <TextInput
        style={[s.input, s.multiline]}
        value={description}
        onChangeText={setDescription}
        maxLength={DESCRIPTION_MAX}
        multiline
        accessibilityLabel={t('create.collectifForm.description')}
      />
      {changingTown ? (
        <LocationPicker
          onGps={useGps}
          onTown={(picked) => {
            setTown(picked);
            setChangingTown(false);
          }}
          onCancel={() => setChangingTown(false)}
        />
      ) : (
        <View style={s.row}>
          <Text>{t('create.collectifForm.town', { town: town?.label ?? collectif.townLabel })}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('collectif.changeTown')}
            disabled={busy}
            onPress={() => setChangingTown(true)}
          >
            <Text style={s.outlineText}>{t('collectif.changeTown')}</Text>
          </Pressable>
        </View>
      )}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={s.error}>
          {errorText(error)}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('collectif.save')}
        accessibilityState={{ disabled: !valid || busy }}
        disabled={!valid || busy}
        style={[s.button, (!valid || busy) && s.disabled]}
        onPress={submit}
      >
        <Text style={s.buttonText}>{busy ? t('collectif.saving') : t('collectif.save')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('collectif.cancel')}
        disabled={busy}
        style={s.outline}
        onPress={onCancel}
      >
        <Text style={s.outlineText}>{t('collectif.cancel')}</Text>
      </Pressable>
    </View>
  );
}
