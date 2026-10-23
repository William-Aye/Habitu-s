import { Ban, Flag } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../account/AccountGate';
import { block } from './blocks';
import { confirmBlock, type BlockEffect } from './confirmBlock';
import { useReportSheet } from './ReportSheet';

export interface PersonRef {
  id: string;
  firstName: string;
}

interface Options {
  /** What blocking a given person does to my place here (leaving the activity, removing a member...). */
  effectOf?: (person: PersonRef) => BlockEffect;
  /** After a block went through. */
  onBlocked?: (person: PersonRef) => void;
}

/** The long-press menu on a person: report or block. */
export function usePersonActions({ effectOf, onBlocked }: Options = {}): {
  openPerson: (person: PersonRef) => Promise<void>;
  personSheet: ReactNode;
} {
  const { t } = useTranslation();
  const requireAccount = useRequireAccount();
  const { openReport, reportSheet } = useReportSheet();
  const [person, setPerson] = useState<PersonRef | null>(null);
  const [busy, setBusy] = useState(false);

  const openPerson = async (p: PersonRef) => {
    if (await requireAccount('join')) setPerson(p);
  };

  const doBlock = (p: PersonRef) => {
    setPerson(null);
    confirmBlock(t, p.firstName, effectOf?.(p) ?? 'plain', async () => {
      if (busy) return;
      setBusy(true);
      const r = await block(p.id);
      setBusy(false);
      if (r.ok) onBlocked?.(p);
    });
  };

  const item = (label: string, icon: ReactNode, onPress: () => void, destructive = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.item} onPress={onPress}>
      {icon}
      <Text style={destructive ? styles.destructive : styles.itemText}>{label}</Text>
    </Pressable>
  );

  const personSheet = (
    <>
      <Modal visible={!!person} transparent animationType="fade" onRequestClose={() => setPerson(null)}>
        <Pressable accessible={false} style={styles.backdrop} onPress={() => setPerson(null)}>
          <View testID="person-actions" accessibilityViewIsModal style={styles.sheet}>
            {person ? (
              <>
                {item(t('safety.reportPerson'), <Flag size={18} color="#1a56db" />, () => {
                  const p = person;
                  setPerson(null);
                  void openReport({ type: 'user', id: p.id });
                })}
                {item(t('safety.block'), <Ban size={18} color="#b91c1c" />, () => doBlock(person), true)}
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('safety.cancel')}
              style={styles.item}
              onPress={() => setPerson(null)}
            >
              <Text style={styles.itemText}>{t('safety.cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {reportSheet}
    </>
  );
  return { openPerson, personSheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12, gap: 4 },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  itemText: { fontSize: 16, color: '#1a56db', fontWeight: '600' },
  destructive: { fontSize: 16, color: '#b91c1c', fontWeight: '600' },
});
