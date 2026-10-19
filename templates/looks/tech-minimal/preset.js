// Tech minimal: cool paper-white on a fine measuring grid, near-black mono type, one electric-blue accent.
// Fonts: the bundled style/fonts files (IBM Plex Mono, Inter: SIL OFL 1.1), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'tech-minimal',
  colors: {
    bg: '#eef0f2',
    grid: '#d6dbe1',
    gridStrong: '#b3bbc5',
    stroke: '#14171c',
    text: '#14171c',
    muted: '#6b7480',
    accent: '#1f4bff',
    accentSoft: '#c9d4ff',
    surface: '#f8f9fa',
    border: '#b9c0c9',
  },
  fonts: {
    sans: "'Inter', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  fontFiles: [
    font('Inter', 'inter-latin-400-normal.woff2', 400),
    font('Inter', 'inter-latin-500-normal.woff2', 500),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', 400),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', 500),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-600-normal.woff2', 600),
  ],
  radius: 0,
  ease: { out: 'outQuad', inOut: 'linear', spring: 'steps(6)' },
};
