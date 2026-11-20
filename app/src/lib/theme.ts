/**
 * Shared design tokens (improvement plan, step 4.1), in the warm and welcoming direction chosen on
 * 2026-11-20. Screens still using the old blue hex literals move over as they are reworked;
 * `accent` and `text` match the public site's `web/public/styles.css` (checked by a test).
 * New styles should use these instead of hex literals; existing screens move over as they are
 * reworked (step 4.2).
 */
export const colors = {
  /** Links, primary buttons, selected states (terracotta, warm and welcoming). 5.5:1 on white. */
  accent: '#b4441f',
  /** Pressed or emphasised accent. */
  accentDark: '#8a3216',
  /** Light accent background (selected chips, highlights). */
  accentSoft: '#fde8dc',
  text: '#2b2118',
  /** Secondary text, a warm grey. Same as the site's --muted. 6.6:1 on white. */
  muted: '#6b5a4e',
  /**
   * Border of text fields, toggles and chips: WCAG 2.2 (1.4.11) asks 3:1 against the background for
   * the edge that shows where a control is. 4.3:1 on white.
   */
  controlBorder: '#8a776b',
  /** Decorative dividers and card edges (no contrast requirement). Same as the site's --border. */
  divider: '#ecd5c4',
  /** Quiet panels and placeholders, a warm off-white. Same as the site's --card. */
  surface: '#fff3ea',
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
