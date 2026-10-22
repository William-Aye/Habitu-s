import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanupExportFiles, deleteMyAccount, exportMyData } from '../src/features/account/myData';
import { touchLastSeen, resetLastSeenForTests } from '../src/features/account/lastSeen';
import { pickAndUploadAvatar } from '../src/features/account/avatar';
import { signOut } from '../src/features/account/auth';
import { supabase } from '../src/lib/supabase';
import { subscribeInterestsChanged } from '../src/features/interests/store';
import { subscribeExploreLocationReset } from '../src/features/explore/useExploreLocation';

const mockWrites: { uri: string; content: string }[] = [];
let mockSize = 100;
const mockDeleted: string[] = [];
const mockCache: string[] = [];
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
        .join('/');
    }
    get size() {
      return mockSize;
    }
    create() {}
    delete() {
      mockDeleted.push(this.uri);
    }
    write(content: string) {
      mockWrites.push({ uri: this.uri, content });
    }
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }
  class Directory {
    list() {
      return mockCache.map((name) => ({
        name,
        delete: () => {
          mockDeleted.push(name);
        },
      }));
    }
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' } } };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('../src/features/account/auth', () => ({ signOut: jest.fn(async () => undefined) }));
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

const Sharing = jest.requireMock('expo-sharing');
const Picker = jest.requireMock('expo-image-picker');
const Manipulator = jest.requireMock('expo-image-manipulator');
const rpc = supabase.rpc as unknown as jest.Mock;
const getSession = supabase.auth.getSession as unknown as jest.Mock;
const storageFrom = supabase.storage.from as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  mockWrites.length = 0;
  mockSize = 100;
  mockDeleted.length = 0;
  mockCache.length = 0;
  resetLastSeenForTests();
  await AsyncStorage.clear();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

describe('exportMyData', () => {
  it('writes the RPC result to a dated cache file and opens the share sheet', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const data = { profile: { first_name: 'Ana' }, interests: [] };
    rpc.mockResolvedValue({ data, error: null });
    const res = await exportMyData();
    jest.useRealTimers();
    expect(rpc).toHaveBeenCalledWith('export_my_data');
    expect(res.ok).toBe(true);
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0].uri).toContain('habitues-mes-donnees-2026-10-22.json');
    expect(JSON.parse(mockWrites[0].content)).toEqual(data);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(mockWrites[0].uri, expect.anything());
    expect(mockDeleted).toEqual([]); // the receiving app may still be reading it
  });

  it('removes old export files at the start of the next export and keeps unrelated ones', async () => {
    rpc.mockResolvedValue({ data: { a: 1 }, error: null });
    mockCache.push('habitues-mes-donnees-2026-10-01.json', 'other.json');
    await exportMyData();
    expect(mockDeleted).toEqual(['habitues-mes-donnees-2026-10-01.json']);
  });

  it('cleanupExportFiles removes leftover exports', () => {
    mockCache.push('habitues-mes-donnees-2026-10-01.json', 'photo.jpg');
    cleanupExportFiles();
    expect(mockDeleted).toEqual(['habitues-mes-donnees-2026-10-01.json']);
  });

  it('deletes the cached file when sharing fails', async () => {
    rpc.mockResolvedValue({ data: { a: 1 }, error: null });
    Sharing.shareAsync.mockRejectedValueOnce(new Error('share failed'));
    expect(await exportMyData()).toEqual({ ok: false });
    expect(mockDeleted).toEqual([mockWrites[0].uri]);
  });

  it('returns ok:false and writes nothing when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await exportMyData()).toEqual({ ok: false });
    expect(mockWrites).toHaveLength(0);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('deleteMyAccount', () => {
  let list: jest.Mock;
  let remove: jest.Mock;
  beforeEach(async () => {
    list = jest.fn(async () => ({ data: [{ name: 'avatar.jpg' }], error: null }));
    remove = jest.fn(async () => ({ data: [], error: null }));
    storageFrom.mockReturnValue({ list, remove });
    rpc.mockResolvedValue({ data: null, error: null });
    await AsyncStorage.multiSet([
      ['interests.local', '{}'],
      ['explore.location', '{}'],
      ['onboarding.done', '1'],
    ]);
  });

  it('removes the avatar files, then calls the RPC, signs out and clears local keys', async () => {
    const res = await deleteMyAccount();
    expect(res).toEqual({ ok: true });
    expect(storageFrom).toHaveBeenCalledWith('avatars');
    expect(list).toHaveBeenCalledWith('u1');
    expect(remove).toHaveBeenCalledWith(['u1/avatar.jpg']);
    expect(rpc).toHaveBeenCalledWith('delete_my_account');
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
    expect(signOut).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('interests.local')).toBeNull();
    expect(await AsyncStorage.getItem('explore.location')).toBeNull();
    expect(await AsyncStorage.getItem('onboarding.done')).toBeNull();
  });

  it('clears the local keys before signing out, then notifies the interests and Explore state', async () => {
    const order: string[] = [];
    (signOut as jest.Mock).mockImplementationOnce(async () => {
      order.push(`signOut:${await AsyncStorage.getItem('onboarding.done')}`);
    });
    const offI = subscribeInterestsChanged(() => order.push('interests'));
    const offL = subscribeExploreLocationReset(() => order.push('location'));
    await deleteMyAccount();
    offI();
    offL();
    expect(order).toEqual(['signOut:null', 'interests', 'location']);
  });

  it('clears the profile photo when the RPC fails after the files were removed', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const eq = jest.fn(async () => ({ error: null }));
    const update = jest.fn(() => ({ eq }));
    from.mockReturnValue({ update });
    expect(await deleteMyAccount()).toEqual({ ok: false });
    expect(update).toHaveBeenCalledWith({ photo_url: null });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('removes leftover export files when the account is deleted', async () => {
    mockCache.push('habitues-mes-donnees-2026-10-01.json');
    await deleteMyAccount();
    expect(mockDeleted).toContain('habitues-mes-donnees-2026-10-01.json');
  });

  it('still resolves ok and resets in-memory state when signOut throws', async () => {
    (signOut as jest.Mock).mockRejectedValueOnce(new Error('signout'));
    const seen: string[] = [];
    const offI = subscribeInterestsChanged(() => seen.push('interests'));
    const offL = subscribeExploreLocationReset(() => seen.push('location'));
    expect(await deleteMyAccount()).toEqual({ ok: true });
    offI();
    offL();
    expect(seen).toEqual(['interests', 'location']);
  });

  it('does not remove anything when there are no avatar files', async () => {
    list.mockResolvedValue({ data: [], error: null });
    expect(await deleteMyAccount()).toEqual({ ok: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it('stops without deleting the account when the file removal fails', async () => {
    remove.mockResolvedValue({ data: null, error: { message: 'nope' } });
    expect(await deleteMyAccount()).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('onboarding.done')).toBe('1');
  });

  it('stops when listing the files fails', async () => {
    list.mockResolvedValue({ data: null, error: { message: 'nope' } });
    expect(await deleteMyAccount()).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clears nothing and stays signed in when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await deleteMyAccount()).toEqual({ ok: false });
    expect(signOut).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('interests.local')).toBe('{}');
    expect(await AsyncStorage.getItem('explore.location')).toBe('{}');
    expect(await AsyncStorage.getItem('onboarding.done')).toBe('1');
  });
});

describe('touchLastSeen', () => {
  it('calls the RPC once for two calls within an hour', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await touchLastSeen();
    await touchLastSeen();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('touch_last_seen');
  });

  it('ignores errors', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    await expect(touchLastSeen()).resolves.toBeUndefined();
  });

  it('retries right away after an RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await touchLastSeen('u1');
    await touchLastSeen('u1');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('calls again after an hour and for another user', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await touchLastSeen('u1');
    now.mockReturnValue(1_000_000 + 3_599_000);
    await touchLastSeen('u1');
    expect(rpc).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 3_600_000);
    await touchLastSeen('u1');
    expect(rpc).toHaveBeenCalledTimes(2);
    await touchLastSeen('u2');
    expect(rpc).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });
});

describe('pickAndUploadAvatar', () => {
  let upload: jest.Mock;
  let eq: jest.Mock;
  beforeEach(() => {
    upload = jest.fn(async () => ({ error: null }));
    storageFrom.mockReturnValue({
      upload,
      getPublicUrl: () => ({ data: { publicUrl: 'https://x/avatars/u1/avatar.jpg' } }),
    });
    eq = jest.fn(async () => ({ error: null }));
    from.mockReturnValue({ update: jest.fn(() => ({ eq })) });
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///pick.jpg', width: 1600 }],
    });
    Manipulator.manipulateAsync.mockResolvedValue({ uri: 'file:///out.jpg' });
  });

  it('returns cancelled when the picker is cancelled', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAndUploadAvatar('u1')).toEqual({ ok: false, error: 'cancelled' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('resizes to 800 px JPEG, uploads with upsert and saves the versioned URL', async () => {
    const res = await pickAndUploadAvatar('u1');
    expect(Manipulator.manipulateAsync).toHaveBeenCalledWith(
      'file:///pick.jpg',
      [{ resize: { width: 800 } }],
      { compress: 0.7, format: 'jpeg' },
    );
    expect(upload).toHaveBeenCalledWith('u1/avatar.jpg', expect.anything(), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toMatch(/^https:\/\/x\/avatars\/u1\/avatar\.jpg\?v=\d+$/);
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('does not resize an image that is not wider than 800 px', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///small.jpg', width: 800 }],
    });
    await pickAndUploadAvatar('u1');
    expect(Manipulator.manipulateAsync).toHaveBeenCalledWith('file:///small.jpg', [], {
      compress: 0.7,
      format: 'jpeg',
    });
  });

  it('rejects files over 1 MB without uploading', async () => {
    mockSize = 1_048_577;
    expect(await pickAndUploadAvatar('u1')).toEqual({ ok: false, error: 'too_large' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports network when the upload fails', async () => {
    upload.mockResolvedValue({ error: { message: 'x' } });
    expect(await pickAndUploadAvatar('u1')).toEqual({ ok: false, error: 'network' });
  });
});
