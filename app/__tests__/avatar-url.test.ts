import { avatarUrl } from '../src/lib/avatarUrl';

const ID = '0b8f2f6e-6f4e-4c55-9a43-0d2f1f2b9c11';
const NAME = `${ID}/0123456789abcdef0123456789abcdef.jpg`;

describe('avatarUrl', () => {
  const env = process.env.EXPO_PUBLIC_SUPABASE_URL;
  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co/';
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = env;
  });

  it('builds the public URL of an avatar object name', () => {
    expect(avatarUrl(NAME)).toBe(`https://proj.supabase.co/storage/v1/object/public/avatars/${NAME}`);
  });

  it('gives nothing for no photo', () => {
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
    expect(avatarUrl('')).toBeNull();
  });

  it('never loads anything that is not an avatar object name (no outside URL, no other bucket)', () => {
    expect(avatarUrl('https://attacker.example/p.gif')).toBeNull();
    expect(avatarUrl(`${ID}/avatar.jpg`)).toBeNull();
    expect(avatarUrl(`../claim-documents/${ID}/x.pdf`)).toBeNull();
    expect(avatarUrl(`${NAME}?x=1`)).toBeNull();
  });
});
