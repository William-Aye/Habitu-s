import Baby from 'lucide-react-native/icons/baby';
import BookOpen from 'lucide-react-native/icons/book-open';
import ChefHat from 'lucide-react-native/icons/chef-hat';
import Cpu from 'lucide-react-native/icons/cpu';
import Dice5 from 'lucide-react-native/icons/dice-5';
import Dumbbell from 'lucide-react-native/icons/dumbbell';
import Footprints from 'lucide-react-native/icons/footprints';
import HandHeart from 'lucide-react-native/icons/hand-heart';
import Languages from 'lucide-react-native/icons/languages';
import Leaf from 'lucide-react-native/icons/leaf';
import Music from 'lucide-react-native/icons/music';
import Palette from 'lucide-react-native/icons/palette';
import Tag from 'lucide-react-native/icons/tag';
import Trees from 'lucide-react-native/icons/trees';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../account/AccountGate';
import { requestCategory } from './categoryRequest';
import { fetchCategories, filterCategories, type Category } from './categories';
import { nextTapLevel, useInterests, type Level } from './store';
import { colors } from '../../lib/theme';

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
                accessibilityActions={[{ name: 'curious', label: levelText('curious') }]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'curious') {
                    setLevel(c.id, level === 'curious' ? null : 'curious');
                  }
                }}
                style={[styles.tile, c.parentId === null && styles.parent, on && styles.tileOn]}
                onPress={() => setLevel(c.id, nextTapLevel(level))}
                onLongPress={() => setLevel(c.id, level === 'curious' ? null : 'curious')}
              >
                <Icon size={20} color={on ? '#fff' : colors.text} />
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
          {request === 'sent' ? (
            <Pressable accessibilityRole="button" style={styles.link} onPress={() => setRequest('form')}>
              <Text style={styles.linkText}>{t('interests.proposeAnother')}</Text>
            </Pressable>
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
    borderColor: colors.controlBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  parent: { borderColor: colors.controlBorder },
  tileOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tileText: { fontSize: 15 },
  tileTextOn: { color: '#fff' },
  level: { fontSize: 12, fontWeight: '600' },
  block: { gap: 8 },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { color: colors.accent, fontWeight: '600', fontSize: 16 },
  outline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
