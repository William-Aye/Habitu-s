import Svg, { Circle, Rect } from 'react-native-svg';
import { colors } from '../../lib/theme';

/**
 * The Habituer mark: two people whose linked arms make the H. Same shapes as the site's
 * web/public/favicon.svg and the app icons. Decorative: the name next to it carries the meaning.
 */
export function LogoMark({ size = 32, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg
      width={(size * 60) / 67}
      height={size}
      viewBox="20 16 60 67"
      aria-hidden
      testID="logo-mark"
    >
      <Circle cx={29} cy={25} r={9} fill={color} />
      <Circle cx={71} cy={25} r={9} fill={color} />
      <Rect x={21} y={39} width={16} height={44} rx={8} fill={color} />
      <Rect x={63} y={39} width={16} height={44} rx={8} fill={color} />
      <Rect x={28} y={53} width={44} height={12} rx={6} fill={color} />
    </Svg>
  );
}
