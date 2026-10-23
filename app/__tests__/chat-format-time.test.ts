import { formatMessageTime } from '../src/features/chat/formatTime';

// 2026-10-23 12:00 in Paris (UTC+2).
const NOW = new Date('2026-10-23T10:00:00Z');

describe('formatMessageTime', () => {
  it('shows HH:MM for today, in Paris time', () => {
    expect(formatMessageTime('2026-10-23T17:05:00Z', NOW)).toBe('19:05');
  });

  it('uses the Paris day, not the UTC day', () => {
    expect(formatMessageTime('2026-10-22T22:30:00Z', NOW)).toBe('00:30');
  });

  it('says hier for the day before, with the given word', () => {
    expect(formatMessageTime('2026-10-22T08:00:00Z', NOW)).toBe('hier');
    expect(formatMessageTime('2026-10-22T08:00:00Z', NOW, 'yesterday')).toBe('yesterday');
  });

  it('shows dd/mm earlier in the current year', () => {
    expect(formatMessageTime('2026-10-21T08:00:00Z', NOW)).toBe('21/10');
    expect(formatMessageTime('2026-01-02T08:00:00Z', NOW)).toBe('02/01');
  });

  it('shows dd/mm/yyyy in other years', () => {
    expect(formatMessageTime('2025-12-31T08:00:00Z', NOW)).toBe('31/12/2025');
  });

  it('handles yesterday across a month boundary', () => {
    expect(formatMessageTime('2026-09-30T08:00:00Z', new Date('2026-10-01T10:00:00Z'))).toBe('hier');
  });
});
