/** Where the "Disponible dans l'application" screens and the header send visitors. */
export function playStoreUrl(): string {
  return process.env.EXPO_PUBLIC_PLAY_STORE_URL ?? '';
}
