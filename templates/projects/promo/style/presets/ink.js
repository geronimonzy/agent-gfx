// "ink" preset (gfx project templates): warm dark stage, orange accent, teal second accent.
// Fonts: Inter and IBM Plex Mono (SIL OFL 1.1), served by the engine from /style/fonts.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'ink',
  colors: {
    bg: '#0f1115',
    grid: '#171a20',
    gridStrong: '#1e2129',
    stroke: '#f2efe9',
    text: '#f2efe9',
    muted: '#8b909c',
    accent: '#ff7a45',
    accentSoft: '#ffb38f',
    accent2: '#4fd1b0',
    surface: '#171a21',
    surfaceRaised: '#1f232c',
    border: '#2b303b',
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
  radius: 12,
  ease: { out: 'outExpo', inOut: 'inOutCubic', spring: 'outElastic(1, .6)' },
};
