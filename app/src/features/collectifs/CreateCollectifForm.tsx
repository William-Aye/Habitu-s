import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { currentCommune } from '../account/homeArea';
import { stepStyles as s } from '../activities/steps/styles';
import type { ApiError, MyCollectif } from '../activities/types';
import { LocationPicker } from '../explore/components/LocationPicker';
import type { Town } from '../explore/types';
import { createCollectif } from './api';

const NAME_MIN = 3;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

/** Inline form: name, short description, town (a commune centre). */
export function CreateCollectifForm({
  onCreated,
  onCancel,
}: {
  onCreated(collectif: MyCollectif): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [town, setTown] = useState<Town | null>(null);
  const [changingTown, setChangingTown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const trimmed = name.trim();
  const valid =
    trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX && description.length <= DESCRIPTION_MAX && town !== null;

  const submit = async () => {
    if (!valid || busy || !town) return;
    setBusy(true);
    setError(null);
    const result = await createCollectif({ name: trimmed, description: description.trim(), town });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onCreated({ id: result.id, name: trimmed, townLabel: town.label, role: 'responsable' });
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
        placeholder={t('create.collectifForm.name')}
        accessibilityLabel={t('create.collectifForm.name')}
      />
      <TextInput
        style={[s.input, s.multiline]}
        value={description}
        onChangeText={setDescription}
        maxLength={DESCRIPTION_MAX}
        multiline
        placeholder={t('create.collectifForm.description')}
        accessibilityLabel={t('create.collectifForm.description')}
      />
      {town && !changingTown ? (
        <View style={s.row}>
          <Text>{t('create.collectifForm.town', { town: town.label })}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('create.where.changeTown')}
            onPress={() => setChangingTown(true)}
          >
            <Text style={s.outlineText}>{t('create.where.changeTown')}</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <Text style={s.hint}>{t('create.collectifForm.townNone')}</Text>
          <LocationPicker
            onGps={useGps}
            onTown={(picked) => {
              setTown(picked);
              setChangingTown(false);
            }}
            onCancel={town ? () => setChangingTown(false) : undefined}
          />
        </View>
      )}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={s.error}>
          {t(`create.errors.${error}`)}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('create.collectifForm.submit')}
        accessibilityState={{ disabled: !valid || busy }}
        disabled={!valid || busy}
        style={[s.button, (!valid || busy) && s.disabled]}
        onPress={submit}
      >
        <Text style={s.buttonText}>{busy ? t('create.collectifForm.creating') : t('create.collectifForm.submit')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('create.collectifForm.cancel')}
        style={s.outline}
        onPress={onCancel}
      >
        <Text style={s.outlineText}>{t('create.collectifForm.cancel')}</Text>
      </Pressable>
    </View>
  );
}
