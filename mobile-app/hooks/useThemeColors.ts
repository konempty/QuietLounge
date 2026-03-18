import { useColorScheme } from 'react-native';
import Colors from '@/constants/Colors';

export function useThemeColors() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? Colors.dark : Colors.light, isDark };
}
