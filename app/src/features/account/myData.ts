import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
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
  if (Platform.OS === 'web') return; // the browser build keeps nothing on disk
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

/** Browser build: the export is handed to the visitor as a downloaded file. */
async function exportMyDataWeb(): Promise<{ ok: true; path: string } | { ok: false }> {
  try {
    const { data, error } = await supabase.rpc('export_my_data');
    if (error) return { ok: false };
    const name = `habitues-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { ok: true, path: name };
  } catch {
    return { ok: false };
  }
}

export async function exportMyData(): Promise<{ ok: true; path: string } | { ok: false }> {
  if (Platform.OS === 'web') return exportMyDataWeb();
  let file: File | null = null;
  let handedOut = false;
  cleanupExportFiles();
  try {
    const { data, error } = await supabase.rpc('export_my_data');
    if (error) return { ok: false };
    const day = new Date().toISOString().slice(0, 10);
    file = new File(Paths.cache, `habitues-mes-donnees-${day}.json`);
    file.create({ overwrite: true });
    file.write(JSON.stringify(data, null, 2));
    handedOut = true;
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
    });
    return { ok: true, path: file.uri };
  } catch {
    return { ok: false };
  } finally {
    // Once the share sheet was opened the file stays (the receiving app may still read it, even if
    // sharing reported an error); cleanupExportFiles() removes it at the next export or app start.
    try {
      if (!handedOut) file?.delete();
    } catch {
      // Already gone or never created.
    }
  }
}

/** Deletes the user's own messages in activities they have left; returns how many went. */
export async function deleteMessagesInLeftActivities(): Promise<{ ok: true; count: number } | { ok: false }> {
  try {
    const { data, error } = await supabase.rpc('delete_my_messages_in_left_activities');
    if (error) return { ok: false };
    return { ok: true, count: typeof data === 'number' ? data : 0 };
  } catch {
    return { ok: false };
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
    // Devices of a deleted account must stop receiving pushes; the server cascade covers a failure here.
    try {
      await supabase.from('push_tokens').delete().eq('user_id', userId);
    } catch {
      // Best effort.
    }
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
    // Handled below.
  }
  // supabase-js only drops the stored session after a successful (or 401/403/404) server call;
  // on a network failure it keeps it. The account is already gone, so always clear it locally too.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing more can be done from here.
  } finally {
    notifyInterestsChanged();
    notifyExploreLocationReset();
  }
  return { ok: true };
}
