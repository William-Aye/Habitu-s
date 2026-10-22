import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteMyAccount, exportMyData } from '../src/features/account/myData';
import { touchLastSeen, resetLastSeenForTests } from '../src/features/account/lastSeen';
import { pickAndUploadAvatar } from '../src/features/account/avatar';
import { signOut } from '../src/features/account/auth';
import { supabase } from '../src/lib/supabase';

const mockWrites: { uri: string; content: string }[] = [];
let mockSize = 100;
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
    write(content: string) {
      mockWrites.push({ uri: this.uri, content });
    }
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } };
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
      assets: [{ uri: 'file:///pick.jpg' }],
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
