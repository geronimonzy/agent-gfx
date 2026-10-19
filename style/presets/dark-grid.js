export default {
  name: 'dark-grid',
  colors: {
    bg: '#111111',
    grid: '#222222',
    gridStrong: '#2c2c2c',
    stroke: '#ededed',
    text: '#ededed',
    muted: '#8a8a8a',
    accent: '#d97757',
    accentSoft: '#e9a58c',
    surface: '#1a1a1a',
    border: '#333333',
  },
  fonts: {
    sans: 'Inter, system-ui, sans-serif',
    mono: 'JetBrains Mono, ui-monospace, monospace',
  },
  fontFiles: [],
  radius: 8,
  ease: { out: 'outExpo', inOut: 'inOutCubic', spring: 'outElastic(1, .6)' },
};
