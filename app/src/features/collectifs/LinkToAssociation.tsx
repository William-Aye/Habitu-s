import { Link2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { linkCollectifToAssociation, myVerifiedAssociations, type ClaimedAssociation } from '../claims/api';

/**
 * "Rattacher le collectif à cette association": for a responsable who has a verified association (an
 * approved claim). Nothing is shown otherwise. The collectif stays; its activities then show the association.
 */
export function LinkToAssociation({ collectifId, onLinked }: { collectifId: string; onLinked?: () => void }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ClaimedAssociation[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const linking = useRef(false);

  useEffect(() => {
    let active = true;
    void myVerifiedAssociations().then((r) => {
      if (active && r.ok) setOptions(r.associations);
    });
    return () => {
      active = false;
    };
  }, []);

  if (options.length === 0) return null;

  const confirm = async () => {
    const target = options.find((o) => o.id === picked);
    if (!target || linking.current) return;
    linking.current = true;
    setBusy(true);
    setFailed(false);
    const r = await linkCollectifToAssociation(collectifId, target.id);
    linking.current = false;
    setBusy(false);
    if (!r.ok) return setFailed(true);
    setOpen(false);
    setDone(r.moved);
    onLinked?.();
  };

  return (
    <View style={styles.box}>
      <View accessibilityLiveRegion="polite">
        {done !== null ? <Text>{t('collectif.linkDone', { count: done })}</Text> : null}
        {failed ? <Text style={styles.error}>{t('collectif.linkError')}</Text> : null}
      </View>
      {open ? (
        <>
          <Text>{t('collectif.linkPick')}</Text>
          <View accessibilityRole="radiogroup" style={styles.box}>
            {options.map((o) => {
              const selected = picked === o.id;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityLabel={o.name}
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  style={[styles.choice, selected && styles.choiceOn]}
                  onPress={() => setPicked(o.id)}
                >
                  <Text style={selected ? styles.choiceOnText : styles.choiceText}>{o.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('collectif.linkConfirm')}
            accessibilityState={{ disabled: busy || !picked, busy }}
            disabled={busy || !picked}
            style={[styles.primary, (busy || !picked) && styles.disabled]}
            onPress={confirm}
          >
            <Text style={styles.primaryText}>{t('collectif.linkConfirm')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('collectif.cancel')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={styles.link}
            onPress={() => setOpen(false)}
          >
            <Text style={styles.linkText}>{t('collectif.cancel')}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('collectif.link')}
          style={[styles.outline, styles.withIcon]}
          onPress={() => {
            setDone(null);
            setOpen(true);
          }}
        >
          <Link2 size={18} color="#1a56db" />
          <Text style={styles.outlineText}>{t('collectif.link')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  withIcon: { flexDirection: 'row', gap: 8 },
  choice: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#1a56db', justifyContent: 'center', paddingHorizontal: 12 },
  choiceOn: { backgroundColor: '#1a56db' },
  choiceText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  choiceOnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  error: { color: '#b91c1c' },
});
