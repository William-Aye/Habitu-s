import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

export const DENIED_AT_KEY = 'push.deniedAt';
/** After a refusal the app waits this long before asking again. */
export const ASK_AGAIN_AFTER_MS = 30 * 24 * 3600 * 1000;

/** Value of AndroidImportance.DEFAULT (the enum is not visible to the import linter). */
const ANDROID_IMPORTANCE_DEFAULT = 3;

export type PushResult = 'registered' | 'denied' | 'unavailable';

function projectId(): string | undefined {
  const c = Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  };
  return c.expoConfig?.extra?.eas?.projectId ?? c.easConfig?.projectId;
}

/** Asks for permission if needed, gets the Expo push token and registers it for the signed-in user. */
export async function registerForPush(): Promise<PushResult> {
  try {
    if (!Device.isDevice) return 'unavailable';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: ANDROID_IMPORTANCE_DEFAULT,
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') {
      if (!perm.canAskAgain) return 'denied';
      perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== 'granted') return 'denied';
    }
    const id = projectId();
    if (!id) return 'unavailable';
    const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token.data,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    return error ? 'unavailable' : 'registered';
  } catch {
    return 'unavailable';
  }
}

/**
 * Called after the user's first "Je serai là" or a created activity (never at launch). Remembers a
 * refusal and stays quiet for 30 days. Never throws: a notification problem must not disturb the action.
 */
export async function askForPush(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DENIED_AT_KEY);
    const deniedAt = raw ? Number(raw) : 0;
    if (deniedAt && Date.now() - deniedAt < ASK_AGAIN_AFTER_MS) return;
    const result = await registerForPush();
    if (result === 'denied') await AsyncStorage.setItem(DENIED_AT_KEY, String(Date.now()));
    else if (result === 'registered') await AsyncStorage.removeItem(DENIED_AT_KEY);
  } catch {
    // Best effort.
  }
}
