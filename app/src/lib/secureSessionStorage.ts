import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';

// Supabase "LargeSecureStore" pattern: the AES-256 key lives in SecureStore
// (Android Keystore, ~2 KB limit), the encrypted session blob in AsyncStorage.

const HEX = /^([0-9a-f]{2})+$/i;

// SecureStore keys only allow alphanumerics, ".", "-" and "_".
const secureKey = (key: string) => `sk_${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const encKey = (key: string) => `enc_${key}`;

function crypt(keyHex: string, bytes: Uint8Array): Uint8Array {
  const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
  return cipher.encrypt(bytes);
}

async function encryptAndStore(key: string, value: string): Promise<void> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const keyHex = aesjs.utils.hex.fromBytes(keyBytes);
  const cipherHex = aesjs.utils.hex.fromBytes(crypt(keyHex, aesjs.utils.utf8.toBytes(value)));
  await SecureStore.setItemAsync(secureKey(key), keyHex);
  await AsyncStorage.setItem(encKey(key), cipherHex);
}

async function removeBoth(key: string): Promise<void> {
  await Promise.allSettled([SecureStore.deleteItemAsync(secureKey(key)), AsyncStorage.removeItem(encKey(key))]);
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const keyHex = await SecureStore.getItemAsync(secureKey(key));
      const cipherHex = await AsyncStorage.getItem(encKey(key));
      if (keyHex && cipherHex) {
        if (!HEX.test(keyHex) || keyHex.length !== 64 || !HEX.test(cipherHex)) {
          throw new Error('corrupt session storage');
        }
        // CTR is symmetric: "encrypting" the ciphertext decrypts it.
        return aesjs.utils.utf8.fromBytes(crypt(keyHex, aesjs.utils.hex.toBytes(cipherHex)));
      }
      // Old adapter stored the session in plain AsyncStorage: migrate once.
      const plain = await AsyncStorage.getItem(key);
      if (plain !== null) {
        await encryptAndStore(key, plain);
        await AsyncStorage.removeItem(key);
        return plain;
      }
      return null;
    } catch {
      await removeBoth(key);
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    await encryptAndStore(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await removeBoth(key);
    await AsyncStorage.removeItem(key);
  },
};
