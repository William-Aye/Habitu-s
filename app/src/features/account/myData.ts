import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { signOut } from './auth';

const LOCAL_KEYS = ['interests.local', 'explore.location', 'onboarding.done'];

export async function exportMyData(): Promise<{ ok: true; path: string } | { ok: false }> {
  try {
    const { data, error } = await supabase.rpc('export_my_data');
    if (error) return { ok: false };
    const day = new Date().toISOString().slice(0, 10);
    const file = new File(Paths.cache, `habitues-mes-donnees-${day}.json`);
    file.create({ overwrite: true });
    file.write(JSON.stringify(data, null, 2));
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
    });
    return { ok: true, path: file.uri };
  } catch {
    return { ok: false };
  }
}

/** Removes the user's avatar files through the Storage API (the SQL delete only drops metadata). */
async function removeAvatarFiles(userId: string): Promise<boolean> {
  const bucket = supabase.storage.from('avatars');
  const { data, error } = await bucket.list(userId);
  if (error) return false;
  const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
  if (paths.length === 0) return true;
  const removed = await bucket.remove(paths);
  return !removed.error;
}

/** Nothing is deleted unless the avatar files are gone first; a failure leaves the user signed in. */
export async function deleteMyAccount(): Promise<{ ok: boolean }> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return { ok: false };
    if (!(await removeAvatarFiles(userId))) return { ok: false };
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return { ok: false };
  } catch {
    return { ok: false };
  }
  await signOut();
  try {
    await AsyncStorage.multiRemove(LOCAL_KEYS);
  } catch {
    // The account is gone; stale local keys are harmless.
  }
  return { ok: true };
}
