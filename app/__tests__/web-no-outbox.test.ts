import fs from 'node:fs';
import path from 'node:path';

const src = path.join(__dirname, '../src');
function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = walk(src).filter((f) => /\.(ts|tsx)$/.test(f));

describe('the web path does not poll the network or run the chat outbox', () => {
  it('only the native outbox imports NetInfo', () => {
    const importers = files
      .filter((f) => /@react-native-community\/netinfo/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f).replace(/\\/g, '/'));
    expect(importers).toEqual(['features/chat/outbox.ts']);
  });

  it('the web outbox shim exists and imports nothing from netinfo or AsyncStorage', () => {
    const shim = path.join(src, 'features/chat/outbox.web.ts');
    expect(fs.existsSync(shim)).toBe(true);
    expect(fs.readFileSync(shim, 'utf8')).not.toMatch(/netinfo|async-storage/);
  });

  it('the web shim is inert and has the same functions as the native module', async () => {
    const netinfo = require('@react-native-community/netinfo');
    const spy = jest.spyOn(netinfo, 'addEventListener');
    const outbox = require('../src/features/chat/outbox.web');
    outbox.initOutbox();
    await outbox.flush();
    await outbox.clearOutbox();
    expect(spy).not.toHaveBeenCalled();
    expect(outbox.enqueue('u', 'a', 'hello')).toBeNull();
    expect(outbox.pending('a', 'u')).toEqual([]);
    expect(typeof outbox.subscribe(() => {})).toBe('function');
    const nativeNames = [
      ...fs.readFileSync(path.join(src, 'features/chat/outbox.ts'), 'utf8').matchAll(/^export (?:async )?function (\w+)/gm),
    ].map((m) => m[1]);
    expect(nativeNames.length).toBeGreaterThan(5);
    for (const n of nativeNames) expect(typeof outbox[n]).toBe('function');
  });

  it('the root layout does not call initOutbox on the web', () => {
    const layout = fs.readFileSync(path.join(src, 'app/_layout.tsx'), 'utf8');
    expect(layout).toMatch(/Platform\.OS !== 'web'[\s\S]{0,60}initOutbox\(\)/);
  });
});
