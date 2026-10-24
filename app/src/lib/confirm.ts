import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  title: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

/** Asks before a destructive action. react-native-web's Alert.alert does nothing, so the website uses the browser's own confirm. */
export function confirmAction({ title, cancelLabel, confirmLabel, onConfirm }: ConfirmOptions): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(title)) void onConfirm();
    return;
  }
  Alert.alert(title, undefined, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: () => void onConfirm() },
  ]);
}
