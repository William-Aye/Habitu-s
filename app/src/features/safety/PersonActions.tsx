import { Ban, Flag } from "lucide-react-native";
import { useRef, useState, type ReactNode } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRequireAccount } from "../account/AccountGate";
import { block } from "./blocks";
import {
  afterModalClosed,
  confirmBlock,
  type BlockEffect,
} from "./confirmBlock";
import { useReportSheet } from "./ReportSheet";

export interface PersonRef {
  id: string;
  firstName: string;
}

interface Options {
  /** What blocking a given person does to my place here (leaving the activity, removing a member...). */
  effectOf?: (person: PersonRef) => BlockEffect;
  /** After a block went through. */
  onBlocked?: (person: PersonRef, effect: BlockEffect) => void;
}

/** The long-press menu on a person: report or block. */
export function usePersonActions({ effectOf, onBlocked }: Options = {}): {
  openPerson: (person: PersonRef) => Promise<void>;
  /** The same two actions, directly (for accessibility actions). */
  reportPerson: (person: PersonRef) => Promise<void>;
  blockPerson: (person: PersonRef) => void;
  personSheet: ReactNode;
} {
  const { t } = useTranslation();
  const requireAccount = useRequireAccount();
  const { openReport, reportSheet } = useReportSheet();
  const [person, setPerson] = useState<PersonRef | null>(null);
  // Set synchronously: two presses on the confirmation in the same tick must block once.
  const blocking = useRef(false);

  const openPerson = async (p: PersonRef) => {
    if (await requireAccount("join")) setPerson(p);
  };

  const blockPerson = (p: PersonRef) => {
    setPerson(null);
    const effect = effectOf?.(p) ?? "plain";
    confirmBlock(t, p.firstName, effect, async () => {
      if (blocking.current) return;
      blocking.current = true;
      const r = await block(p.id);
      blocking.current = false;
      if (r.ok) onBlocked?.(p, effect);
      else Alert.alert(t("safety.error"));
    });
  };

  const reportPerson = (p: PersonRef) => openReport({ type: "user", id: p.id });

  const personSheet = (
    <>
      <Modal
        visible={!!person}
        transparent
        animationType="fade"
        onRequestClose={() => setPerson(null)}
      >
        <Pressable
          accessible={false}
          style={styles.backdrop}
          onPress={() => setPerson(null)}
        >
          <View
            testID="person-actions"
            accessibilityViewIsModal
            style={styles.sheet}
          >
            {person ? (
              <>
                <Item
                  label={t("safety.reportPerson")}
                  icon={<Flag size={18} color="#1a56db" />}
                  onPress={() => {
                    const p = person;
                    setPerson(null);
                    // The next modal opens once this one is gone (iOS drops a modal opened mid-dismiss).
                    afterModalClosed(() => void reportPerson(p));
                  }}
                />
                <Item
                  label={t("safety.block")}
                  icon={<Ban size={18} color="#b91c1c" />}
                  destructive
                  onPress={() => blockPerson(person)}
                />
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("safety.cancel")}
              style={styles.item}
              onPress={() => setPerson(null)}
            >
              <Text style={styles.itemText}>{t("safety.cancel")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {reportSheet}
    </>
  );
  return { openPerson, reportPerson, blockPerson, personSheet };
}

function Item({
  label,
  icon,
  onPress,
  destructive = false,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.item}
      onPress={onPress}
    >
      {icon}
      <Text style={destructive ? styles.destructive : styles.itemText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 12,
    gap: 4,
  },
  item: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
  },
  itemText: { fontSize: 16, color: "#1a56db", fontWeight: "600" },
  destructive: { fontSize: 16, color: "#b91c1c", fontWeight: "600" },
});
