import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fetchCategories, filterCategories, type Category } from '../../interests/categories';
import { DESCRIPTION_MAX, TITLE_MAX } from '../form';
import { stepStyles as s, type StepProps } from './styles';

const TEMPLATES = ['games', 'running', 'languages'] as const;

export function WhatStep({ form, set }: StepProps) {
  const { t, i18n } = useTranslation();
  const lang: 'fr' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');

  const load = useCallback(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(() => (categories ? filterCategories(categories, text, lang) : []), [categories, text, lang]);

  return (
    <View style={s.container}>
      <Text style={s.label}>{t('create.what.category')}</Text>
      {failed ? (
        <View style={s.container}>
          <Text style={s.error}>{t('create.what.categoriesError')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('create.retry')} style={s.outline}
            onPress={() => {
              setFailed(false);
              load();
            }}
          >
            <Text style={s.outlineText}>{t('create.retry')}</Text>
          </Pressable>
        </View>
      ) : !categories ? (
        <ActivityIndicator accessibilityLabel={t('create.loading')} />
      ) : (
        <>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder={t('create.what.categorySearch')}
            accessibilityLabel={t('create.what.categorySearch')}
          />
          <View style={s.wrap} accessibilityRole="radiogroup">
            {visible.map((c) => {
              const name = lang === 'en' ? c.nameEn : c.nameFr;
              const on = form.categoryId === c.id;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="radio"
                  accessibilityLabel={name}
                  accessibilityState={{ selected: on }}
                  style={[s.option, on && s.optionOn]}
                  onPress={() => set({ categoryId: c.id })}
                >
                  <Text style={[s.optionText, on && s.optionTextOn]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={s.label}>{t('create.what.templates')}</Text>
      <View style={s.wrap}>
        {TEMPLATES.map((key) => {
          const title = t(`create.templates.${key}.title`);
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={title}
              style={s.option}
              onPress={() => set({ title, description: t(`create.templates.${key}.description`) })}
            >
              <Text style={s.optionText}>{title}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.label}>{t('create.what.title')}</Text>
      <TextInput
        style={s.input}
        value={form.title}
        onChangeText={(title) => set({ title })}
        maxLength={TITLE_MAX}
        accessibilityLabel={t('create.what.title')}
      />
      <Text style={s.label}>{t('create.what.description')}</Text>
      <TextInput
        style={[s.input, s.multiline]}
        value={form.description}
        onChangeText={(description) => set({ description })}
        maxLength={DESCRIPTION_MAX}
        multiline
        accessibilityLabel={t('create.what.description')}
      />
      <Text style={s.hint}>{t('create.what.counter', { n: form.description.length, max: DESCRIPTION_MAX })}</Text>
    </View>
  );
}
