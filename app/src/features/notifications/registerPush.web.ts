// The web build never asks for the push permission and registers nothing.

export const DENIED_AT_KEY = 'push.deniedAt';
export const ASK_AGAIN_AFTER_MS = 30 * 24 * 3600 * 1000;

export type PushResult = 'registered' | 'denied' | 'unavailable';

export async function registerForPush(): Promise<PushResult> {
  return 'unavailable';
}

export async function refreshPushRegistration(): Promise<PushResult> {
  return 'unavailable';
}

export async function unregisterThisDevice(): Promise<void> {}

export async function askForPush(): Promise<void> {}
