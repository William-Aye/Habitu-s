/**
 * profiles.photo_url holds the avatar's object name, `<user id>/<32 random hex>.jpg` (the database
 * accepts nothing else). This builds its public URL. Anything that is not such a name gives null, so
 * the app never loads a photo from anywhere but this project's avatars bucket.
 */
const AVATAR_NAME = /^[0-9a-f-]{36}\/[0-9a-f]{32}\.jpg$/;

export function avatarUrl(photo: string | null | undefined): string | null {
  if (!photo || !AVATAR_NAME.test(photo)) return null;
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/avatars/${photo}`;
}
