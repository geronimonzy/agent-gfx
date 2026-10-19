// "paper" preset (gfx project templates): warm light paper, blue accent, red second accent.
// Fonts: Inter and IBM Plex Mono (SIL OFL 1.1), served by the engine from /style/fonts.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'paper',
  colors: {
    bg: '#f4f1ea',
    grid: '#ebe6dc',
    gridStrong: '#e0d9cb',
    stroke: '#1d1f24',
    text: '#1d1f24',
    muted: '#6b6f78',
    accent: '#2f5bea',
    accentSoft: '#9db0f6',
    accent2: '#e5533c',
    surface: '#ffffff',
    surfaceRaised: '#faf8f3',
    border: '#d8d0c0',
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
