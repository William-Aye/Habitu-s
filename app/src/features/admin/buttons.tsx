import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../lib/theme';

export function AdminButton({
  label,
  onPress,
  disabled,
  busy,
  variant = 'outline',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'outline' | 'danger';
}) {
  const off = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      style={[styles.btn, variant === 'primary' && styles.primary, variant === 'danger' && styles.danger, off && styles.dim]}
      onPress={onPress}
    >
      <Text style={[styles.btnText, variant !== 'outline' && styles.btnTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  btnTextOn: { color: '#fff' },
  dim: { opacity: 0.5 },
});
