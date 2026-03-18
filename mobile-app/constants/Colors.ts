const primary = '#1FAF63';
const danger = '#e74c3c';

export default {
  primary,
  danger,
  light: {
    text: '#000',
    textSecondary: '#666',
    textTertiary: '#999',
    background: '#f5f5f5',
    card: '#fff',
    border: '#e0e0e0',
    tabBar: '#fff',
    tabBarBorder: '#e0e0e0',
    tint: primary,
    switchTrackOff: '#ccc',
    dangerBorder: 'rgba(231, 76, 60, 0.2)',
  },
  dark: {
    text: '#fff',
    textSecondary: '#888',
    textTertiary: '#555',
    background: '#1a1a1a',
    card: '#222',
    border: '#333',
    tabBar: '#1a1a1a',
    tabBarBorder: '#333',
    tint: primary,
    switchTrackOff: '#333',
    dangerBorder: 'rgba(231, 76, 60, 0.2)',
  },
} as const;