import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { supabase } from '../../lib/supabase';

export const MAX_AVATAR_BYTES = 1_048_576;

export type AvatarResult =
  | { ok: true; url: string }
  | { ok: false; error: 'cancelled' | 'too_large' | 'network' };

/**
 * Picks a photo, re-encodes it on the phone (JPEG, 800 px wide, which drops all metadata incl. GPS),
 * uploads it to `avatars/<userId>/avatar.jpg` and saves the public URL on the profile.
 */
export async function pickAndUploadAvatar(userId: string): Promise<AvatarResult> {
  try {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images' });
    if (picked.canceled || !picked.assets?.[0]) return { ok: false, error: 'cancelled' };

    const asset = picked.assets[0];
    // Only shrink: a small image is re-encoded as is (never upscaled). Unknown width: resize.
    const actions = asset.width !== undefined && asset.width <= 800 ? [] : [{ resize: { width: 800 } }];
    const out = await manipulateAsync(asset.uri, actions, {
      compress: 0.7,
      format: SaveFormat.JPEG,
    });
    const file = new File(out.uri);
    if ((file.size ?? 0) > MAX_AVATAR_BYTES) return { ok: false, error: 'too_large' };

    const path = `${userId}/avatar.jpg`;
    const bucket = supabase.storage.from('avatars');
    const { error } = await bucket.upload(path, await file.arrayBuffer(), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) return { ok: false, error: 'network' };

    // The version suffix defeats image caches: the file name never changes.
    const url = `${bucket.getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
    const { error: saveError } = await supabase.from('profiles').update({ photo_url: url }).eq('id', userId);
    if (saveError) return { ok: false, error: 'network' };
    return { ok: true, url };
  } catch {
    return { ok: false, error: 'network' };
  }
}
