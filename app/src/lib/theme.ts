/**
 * Shared design tokens (improvement plan, step 4.1). The values are the ones the app already uses;
 * `accent`, `text` and `muted` match the public site's `web/public/styles.css` (checked by a test).
 * New styles should use these instead of hex literals; existing screens move over as they are
 * reworked (step 4.2).
 */
export const colors = {
  /** Links, primary buttons, selected states. 6.2:1 on white. */
  accent: '#1a56db',
  /** Pressed or emphasised accent. */
  accentDark: '#1a3a9e',
  /** Light accent background (selected chips, highlights). */
  accentSoft: '#eef2ff',
  text: '#1a1a1a',
  /** Secondary text. 7.6:1 on white. */
  muted: '#4b5563',
  /**
   * Border of text fields, toggles and chips: WCAG 2.2 (1.4.11) asks 3:1 against the background for
   * the edge that shows where a control is. 4.8:1 on white.
   */
  controlBorder: '#6b7280',
  /** Decorative dividers and card edges (no contrast requirement). */
  divider: '#d1d5db',
  danger: '#b91c1c',
  success: '#15803d',
  warningText: '#92400e',
  warningSoft: '#fef3c7',
  background: '#ffffff',
} as const;

/** Font sizes in use, smallest to largest. 16 is the body size. */
export const fontSize = { xs: 12, sm: 14, body: 16, lg: 18, xl: 22 } as const;

/** Minimum touch target (Android and WCAG 2.2 2.5.8 recommend at least 44 to 48). */
export const minTouch = 44;
