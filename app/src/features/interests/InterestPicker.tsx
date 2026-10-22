import {
  Baby,
  BookOpen,
  ChefHat,
  Cpu,
  Dice5,
  Dumbbell,
  Footprints,
  HandHeart,
  Languages,
  Leaf,
  Music,
  Palette,
  Tag,
  Trees,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../account/AccountGate';
import { requestCategory } from './categoryRequest';
import { fetchCategories, filterCategories, type Category } from './categories';
import { nextTapLevel, useInterests, type Level } from './store';

type IconComponent = ComponentType<{ size?: number; color?: string }>;

const ICONS: Record<string, IconComponent> = {
  baby: Baby,
  'book-open': BookOpen,
  'chef-hat': ChefHat,
  cpu: Cpu,
  'dice-5': Dice5,
  dumbbell: Dumbbell,
  footprints: Footprints,
  'hand-heart': HandHeart,
  languages: Languages,
  leaf: Leaf,
  music: Music,
  palette: Palette,
  trees: Trees,
};

/** Parents in order, each followed by its children. */
function ordered(list: Category[]): Category[] {
  const out: Category[] = [];
  const ids = new Set(list.map((c) => c.id));
  for (const parent of list.filter((c) => c.parentId === null || !ids.has(c.parentId))) {
    out.push(parent);
    for (const child of list) if (child.parentId === parent.id) out.push(child);
  }
  return out;
}

type RequestState = 'closed' | 'form' | 'sending' | 'sent' | 'invalid' | 'signed_out' | 'error';

export function InterestPicker({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang: 'fr' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const requireAccount = useRequireAccount();
  const { interests, setLevel } = useInterests();

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [request, setRequest] = useState<RequestState>('closed');
  const [name, setName] = useState('');

  const load = useCallback(() => {
    fetchCategories()
      .then((list) => {
        setFailed(false);
        setCategories(list);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(
    () => (categories ? ordered(filterCategories(categories, text, lang)) : []),
    [categories, text, lang],
  );

  const openRequest = async () => {
    const ok = await requireAccount('category');
    if (ok) setRequest('form');
  };

  const send = async () => {
    setRequest('sending');
    try {
      const r = await requestCategory(name);
      setRequest(r);
      if (r === 'sent') setName('');
    } catch {
      setRequest('error');
    }
  };

  const levelText = (level: Level) => t(`interests.levels.${level}`);
  const message: Partial<Record<RequestState, string>> = {
    sent: t('interests.requestSent'),
    invalid: t('interests.requestInvalid'),
    signed_out: t('interests.requestSignedOut'),
    error: t('interests.requestError'),
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, compact && styles.compact]}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        accessibilityLabel={t('interests.filterLabel')}
        placeholder={t('interests.filterPlaceholder')}
        value={text}
        onChangeText={setText}
        autoCorrect={false}
        style={styles.input}
      />
      {!compact ? <Text style={styles.hint}>{t('interests.hint')}</Text> : null}
      {failed ? (
        <View style={styles.block} accessibilityLiveRegion="polite">
          <Text>{t('interests.loadError')}</Text>
          <Pressable accessibilityRole="button" style={styles.outline} onPress={load}>
            <Text style={styles.outlineText}>{t('interests.retry')}</Text>
          </Pressable>
        </View>
      ) : !categories ? (
        <ActivityIndicator accessibilityLabel={t('explore.loading')} />
      ) : visible.length === 0 ? (
        <Text>{t('interests.empty')}</Text>
      ) : (
        <View style={styles.grid}>
          {visible.map((c) => {
            const level = interests[c.id] ?? null;
            const label = lang === 'en' ? c.nameEn : c.nameFr;
            const Icon = ICONS[c.icon] ?? Tag;
            const on = level !== null;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: on }}
                accessibilityValue={level ? { text: levelText(level) } : undefined}
                style={[styles.tile, c.parentId === null && styles.parent, on && styles.tileOn]}
                onPress={() => setLevel(c.id, nextTapLevel(level))}
                onLongPress={() => setLevel(c.id, level === 'curious' ? null : 'curious')}
              >
                <Icon size={20} color={on ? '#fff' : '#222'} />
                <Text style={[styles.tileText, on && styles.tileTextOn]}>{label}</Text>
                {level ? (
                  <Text style={[styles.level, styles.tileTextOn]}>{levelText(level)}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {request === 'closed' ? (
        <Pressable accessibilityRole="button" style={styles.link} onPress={() => {
            void openRequest();
          }}>
          <Text style={styles.linkText}>{t('interests.propose')}</Text>
        </Pressable>
      ) : (
        <View style={styles.block}>
          {request !== 'sent' ? (
            <>
              <TextInput
                accessibilityLabel={t('interests.requestLabel')}
                placeholder={t('interests.requestLabel')}
                value={name}
                onChangeText={setName}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('interests.requestSend')}
                disabled={request === 'sending'}
                style={styles.primary}
                onPress={() => {
                  void send();
                }}
              >
                <Text style={styles.primaryText}>{t('interests.requestSend')}</Text>
              </Pressable>
            </>
          ) : null}
          {message[request] ? (
            <Text accessibilityLiveRegion="polite">{message[request]}</Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, paddingBottom: 24 },
  compact: { gap: 8, paddingBottom: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  hint: { color: '#555', fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  parent: { borderColor: '#888' },
  tileOn: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  tileText: { fontSize: 15 },
  tileTextOn: { color: '#fff' },
  level: { fontSize: 12, fontWeight: '600' },
  block: { gap: 8 },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600', fontSize: 16 },
  outline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
