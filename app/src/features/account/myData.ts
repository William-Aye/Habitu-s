import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { notifyExploreLocationReset } from '../explore/useExploreLocation';
import { notifyInterestsChanged } from '../interests/store';
import { signOut } from './auth';

const LOCAL_KEYS = ['interests.local', 'explore.location', 'onboarding.done'];

const EXPORT_FILE = /^habitues-mes-donnees-.*\.json$/;

/** Removes leftover personal-data exports from the cache (the share sheet may still read a fresh one, so this runs later). */
export function cleanupExportFiles(): void {
  try {
    for (const item of new Directory(Paths.cache).list()) {
      if (!EXPORT_FILE.test(item.name)) continue;
      try {
        item.delete();
      } catch {
        // Already gone.
      }
    }
  } catch {
    // Unreadable cache: nothing to clean.
  }
}

export async function exportMyData(): Promise<{ ok: true; path: string } | { ok: false }> {
  let file: File | null = null;
  let shared = false;
  cleanupExportFiles();
  try {
    const { data, error } = await supabase.rpc('export_my_data');
    if (error) return { ok: false };
    const day = new Date().toISOString().slice(0, 10);
    file = new File(Paths.cache, `habitues-mes-donnees-${day}.json`);
    file.create({ overwrite: true });
    file.write(JSON.stringify(data, null, 2));
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
    });
    shared = true;
    return { ok: true, path: file.uri };
  } catch {
    return { ok: false };
  } finally {
    // After a successful share the file stays (the receiving app may still read it);
    // cleanupExportFiles() removes it at the next export or app start. A failure leaves nothing behind.
    try {
      if (!shared) file?.delete();
    } catch {
      // Already gone or never created.
    }
  }
}

/** Removes the user's avatar files through the Storage API (the SQL delete only drops metadata). */
async function removeAvatarFiles(userId: string): Promise<'none' | 'removed' | 'failed'> {
  const bucket = supabase.storage.from('avatars');
  const { data, error } = await bucket.list(userId);
  if (error) return 'failed';
  const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
  if (paths.length === 0) return 'none';
  const removed = await bucket.remove(paths);
  return removed.error ? 'failed' : 'removed';
}

/** Nothing is deleted unless the avatar files are gone first; a failure leaves the user signed in. */
export async function deleteMyAccount(): Promise<{ ok: boolean }> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return { ok: false };
    const files = await removeAvatarFiles(userId);
    if (files === 'failed') return { ok: false };
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      // The account survives but its photo file is gone: do not leave a broken photo URL.
      if (files === 'removed') {
        try {
          await supabase.from('profiles').update({ photo_url: null }).eq('id', userId);
        } catch {
          // Best effort.
        }
      }
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
  cleanupExportFiles();
  // Local data first, so nothing of the deleted user can reappear once the session is gone.
  try {
    await AsyncStorage.multiRemove(LOCAL_KEYS);
  } catch {
    // The account is gone; stale local keys are harmless.
  }
  try {
    await signOut();
  } catch {
    // The server side is already deleted: the session dies on its own.
  } finally {
    notifyInterestsChanged();
    notifyExploreLocationReset();
  }
  return { ok: true };
}
