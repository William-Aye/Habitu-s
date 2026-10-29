import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { supabase } from '../../lib/supabase';

export const MAX_AVATAR_BYTES = 1_048_576;

export type AvatarResult =
  /** `url` is the saved object name (profiles.photo_url); lib/avatarUrl turns it into a URL. */
  | { ok: true; url: string }
  | { ok: false; error: 'cancelled' | 'too_large' | 'network' };

/**
 * Re-encodes a picked image on the phone as JPEG (which drops all metadata, GPS included), at most
 * `maxWidth` wide. Only shrinks: a small image is re-encoded as is (never upscaled). Unknown width: resize.
 */
export async function reencodeJpeg(uri: string, width: number | undefined, maxWidth: number): Promise<File> {
  const actions = width !== undefined && width <= maxWidth ? [] : [{ resize: { width: maxWidth } }];
  const out = await manipulateAsync(uri, actions, { compress: 0.7, format: SaveFormat.JPEG });
  return new File(out.uri);
}

/**
 * Picks a photo, re-encodes it on the phone (JPEG, 800 px wide, which drops all metadata incl. GPS),
 * uploads it to `avatars/<userId>/<random>.jpg` and saves that object name on the profile. The name is
 * new and unguessable for every upload, so knowing someone's id never gives their photo; the server
 * then queues the previous files for deletion.
 */
export async function pickAndUploadAvatar(userId: string): Promise<AvatarResult> {
  try {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images' });
    if (picked.canceled || !picked.assets?.[0]) return { ok: false, error: 'cancelled' };

    const asset = picked.assets[0];
    const file = await reencodeJpeg(asset.uri, asset.width, 800);
    if ((file.size ?? 0) > MAX_AVATAR_BYTES) return { ok: false, error: 'too_large' };

    const path = `${userId}/${randomUUID().replace(/-/g, '')}.jpg`;
    const bucket = supabase.storage.from('avatars');
    const { error } = await bucket.upload(path, await file.arrayBuffer(), {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) return { ok: false, error: 'network' };

    const { error: saveError } = await supabase.from('profiles').update({ photo_url: path }).eq('id', userId);
    if (saveError) {
      // Best effort: the server would sweep it at the next photo change anyway.
      await bucket.remove([path]).catch(() => undefined);
      return { ok: false, error: 'network' };
    }
    return { ok: true, url: path };
  } catch {
    return { ok: false, error: 'network' };
  }
}
