import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

export const DENIED_AT_KEY = 'push.deniedAt';
/** After a refusal the app waits this long before asking again. */
export const ASK_AGAIN_AFTER_MS = 30 * 24 * 3600 * 1000;

export type PushResult = 'registered' | 'denied' | 'unavailable';

function projectId(): string | undefined {
  const c = Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  };
  return c.expoConfig?.extra?.eas?.projectId ?? c.easConfig?.projectId;
}

async function clearDenial(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DENIED_AT_KEY);
  } catch {
    // Best effort.
  }
}

/** Gets the Expo push token and registers it for the signed-in user (permission must already be granted). */
async function registerToken(): Promise<PushResult> {
  if (Platform.OS === 'android') {
    // HIGH gives a heads-up for the day-before reminder; MIN or DEFAULT would be silent or easy to miss.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: AndroidImportance.HIGH,
    });
  }
  const id = projectId();
  if (!id) return 'unavailable';
  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token.data,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  return error ? 'unavailable' : 'registered';
}

/** Asks for permission if needed, then registers the token. */
export async function registerForPush(): Promise<PushResult> {
  try {
    if (!Device.isDevice) return 'unavailable';
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') {
      if (!perm.canAskAgain) return 'denied';
      perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== 'granted') return 'denied';
    }
    return await registerToken();
  } catch {
    return 'unavailable';
  }
}

/** At launch and on token changes: registers the token if permission is already granted. Never prompts. */
export async function refreshPushRegistration(): Promise<PushResult> {
  try {
    if (!Device.isDevice) return 'unavailable';
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return 'denied';
    await clearDenial();
    return await registerToken();
  } catch {
    return 'unavailable';
  }
}

/**
 * On sign-out: removes this device's token for the user who is leaving, so their reminders (which
 * carry activity titles) do not reach a phone another person now uses. Best effort, never prompts.
 */
export async function unregisterThisDevice(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return;
    const id = projectId();
    if (!id) return;
    const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await supabase.from('push_tokens').delete().eq('token', token.data);
  } catch {
    // Best effort: signing out must not depend on it.
  }
}

/**
 * Called after the user's first "Je serai là" or a created activity (never at launch). Prompts only
 * while the permission is undetermined; a refusal is remembered for 30 days. When already granted the
 * launch registration does the work. Never throws: a notification problem must not disturb the action.
 */
export async function askForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status === 'granted') {
      await clearDenial();
      return;
    }
    const raw = await AsyncStorage.getItem(DENIED_AT_KEY);
    const deniedAt = raw ? Number(raw) : 0;
    if (deniedAt && Date.now() - deniedAt < ASK_AGAIN_AFTER_MS) return;
    const result = await registerForPush();
    if (result === 'denied') await AsyncStorage.setItem(DENIED_AT_KEY, String(Date.now()));
    else if (result === 'registered') await clearDenial();
  } catch {
    // Best effort.
  }
}
