import { render, screen } from '@testing-library/react-native';
import { LogoMark } from '../src/features/brand/LogoMark';
import { colors } from '../src/lib/theme';

describe('LogoMark', () => {
  it('draws the two people and their arms in the accent colour, keeping the 60:67 shape', async () => {
    await render(<LogoMark size={67} />);
    const svg = screen.getByTestId('logo-mark', { includeHiddenElements: true });
    expect(svg.props.width).toBe(60);
    expect(svg.props.height).toBe(67);
    expect(colors.accent).toBe('#b4441f');
  });

  it('is hidden from screen readers, since the name next to it carries the meaning', async () => {
    await render(<LogoMark />);
    expect(screen.queryByTestId('logo-mark')).toBeNull();
    expect(screen.getByTestId('logo-mark', { includeHiddenElements: true })).toBeTruthy();
  });
});
