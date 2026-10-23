import { StyleSheet } from 'react-native';
import type { FormState } from '../form';

export interface StepProps {
  form: FormState;
  set(patch: Partial<FormState>): void;
}

/** Look shared by the five steps. */
export const stepStyles = StyleSheet.create({
  container: { gap: 12 },
  heading: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, color: '#555' },
  error: { fontSize: 14, color: '#a00' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ccc',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  optionOn: { borderColor: '#1a56db', backgroundColor: '#eef2ff' },
  optionText: { fontSize: 16 },
  optionTextOn: { color: '#1a3a9e', fontWeight: '600' },
  button: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
});
