// Fonts: the bundled style/fonts files (Inter, IBM Plex Mono: SIL OFL 1.1), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: '{{id}}',
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
    sans: "'Inter', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  fontFiles: [
    font('Inter', 'inter-latin-400-normal.woff2', 400),
    font('Inter', 'inter-latin-500-normal.woff2', 500),
    font('Inter', 'inter-latin-600-normal.woff2', 600),
    font('Inter', 'inter-latin-700-normal.woff2', 700),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', 400),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', 500),
  ],
  radius: 8,
  ease: { out: 'outExpo', inOut: 'inOutCubic', spring: 'outElastic(1, .6)' },
};
