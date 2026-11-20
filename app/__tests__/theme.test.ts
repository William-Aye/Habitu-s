import fs from 'fs';
import path from 'path';
import { colors } from '../src/lib/theme';

// WCAG 2.2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens (plan step 4.1)', () => {
  it('text colours reach 4.5:1 on the background (WCAG 1.4.3)', () => {
    for (const c of [colors.text, colors.muted, colors.accent, colors.danger, colors.success, colors.warningText]) {
      expect(contrast(c, colors.background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#ffffff', colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.warningText, colors.warningSoft)).toBeGreaterThanOrEqual(4.5);
    for (const c of [colors.text, colors.muted, colors.accent]) {
      expect(contrast(c, colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#ffffff', colors.muted)).toBeGreaterThanOrEqual(4.5);
  });

  it('control borders reach 3:1 on the background (WCAG 1.4.11)', () => {
    expect(contrast(colors.controlBorder, colors.background)).toBeGreaterThanOrEqual(3);
  });

  it('the app and the public site use the same accent, text, muted, border and card colours', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../web/public/styles.css'), 'utf8');
    const root = css.slice(css.indexOf(':root'), css.indexOf('}'));
    expect(root).toContain(`--accent: ${colors.accent};`);
    expect(root).toContain(`--text: ${colors.text};`);
    expect(root).toContain(`--muted: ${colors.muted};`);
    expect(root).toContain(`--border: ${colors.divider};`);
    expect(root).toContain(`--card: ${colors.surface};`);
  });

  it('accent text reads on the soft accent background, and soft text on the accent (chat bubbles)', () => {
    expect(contrast(colors.accent, colors.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accentDark, colors.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accentSoft, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('no screen goes back to the old blue palette (step 4.2, warm and welcoming)', () => {
    const src = path.join(__dirname, '../src');
    const hits: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && /#(1a56db|1a3a9e|eef2ff|eef3ff|dbeafe)\b/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(src, p));
    });
    walk(src);
    expect(hits).toEqual([]);
  });

  it('no text field or control goes back to a border lighter than 3:1', () => {
    const src = path.join(__dirname, '../src');
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p);
    });
    walk(src);
    const light = /\b(input|search|chip|choice|seg|option|tile|tag)[A-Za-z]*: \{[^}]*borderColor: '#(ccc|888|9ca3af|d1d5db|e5e7eb|eee)'/;
    expect(files.filter((f) => light.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(src, f))).toEqual([]);
  });
});
