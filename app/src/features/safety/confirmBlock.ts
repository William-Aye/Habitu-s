import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

/** What blocking this person does to my place in the activity. */
export type BlockEffect = 'plain' | 'leaves_activity' | 'removes_member';

/** Asks before blocking. The warning says when it also ends a membership. */
export function confirmBlock(t: TFunction, firstName: string, effect: BlockEffect, onConfirm: () => void) {
  const body =
    effect === 'leaves_activity'
      ? t('chat.actions.blockBodyOrganiser')
      : effect === 'removes_member'
        ? t('chat.actions.blockBodyMember')
        : t('chat.actions.blockBody');
  Alert.alert(t('chat.actions.blockTitle', { prenom: firstName }), body, [
    { text: t('chat.actions.cancel'), style: 'cancel' },
    { text: t('chat.actions.block', { prenom: firstName }), style: 'destructive', onPress: onConfirm },
  ]);
}
