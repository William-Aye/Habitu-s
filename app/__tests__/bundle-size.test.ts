import fs from 'fs';
import path from 'path';

// Plan step 2.2: Metro does not drop unused exports, so `import { X } from 'lucide-react-native'` ships
// all ~1,500 icons (2.1 MB of a 4.9 MB Android bundle). Import each icon from its own file instead:
// `import X from 'lucide-react-native/icons/x'` (2.8 MB bundle).
it('no source file imports icons from the lucide-react-native barrel', () => {
  const src = path.join(__dirname, '../src');
  const hits: string[] = [];
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p) && /import\s+(?!type\b)[^;]*from\s+['"]lucide-react-native['"]/.test(fs.readFileSync(p, 'utf8'))) {
      hits.push(path.relative(src, p));
    }
  });
  walk(src);
  expect(hits).toEqual([]);
});
