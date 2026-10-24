import { router } from 'expo-router';
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

/** Leaves a screen whose content is gone for me: back, or home when there is nothing to go back to. */
export function leaveScreen() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Runs `fn` once the modal that is closing has gone. iOS drops a modal (or alert) opened while another is
 * still dismissing, and React Native offers no portable "dismissed" callback.
 */
export function afterModalClosed(fn: () => void) {
  setTimeout(fn, 400);
}
