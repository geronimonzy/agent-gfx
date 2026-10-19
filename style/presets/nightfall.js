// nightfall — neutral built-in preset: deep slate stage, teal accent, warm amber secondary. Used by scenes/_reel-test.
// Fonts are the bundled style/fonts files (Inter and IBM Plex Mono: OFL-1.1; Ubuntu: Ubuntu Font Licence 1.0, not OFL), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'nightfall',
  colors: {
    bg: '#151b24',          // deep slate stage
    grid: '#1e2630',
    gridStrong: '#27313d',
    stroke: '#edf2f4',
    text: '#edf2f4',
    muted: '#8b98a5',
    accent: '#2fb7a4',      // teal
    accentSoft: '#8fdccf',
    accentDeep: '#16786d',
    glow: '#1fa595',
    glowBlue: '#2b8fbd',
    surface: '#1c242e',     // cards on dark
    surfaceRaised: '#25303b',
    band: '#161d26',
    border: '#37434f',
    paper: '#fbf8f1',       // receipt paper
    ink: '#1d232b',
    danger: '#e0664f',
    amber: '#e8a64a',       // warm secondary
  },
  fonts: {
    sans: "'Inter', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    num: "'Ubuntu', 'Inter', sans-serif", // money & stats, tabular
  },
  fontFiles: [
    font('Inter', 'inter-latin-400-normal.woff2', 400),
    font('Inter', 'inter-latin-500-normal.woff2', 500),
    font('Inter', 'inter-latin-600-normal.woff2', 600),
    font('Inter', 'inter-latin-700-normal.woff2', 700),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', 400),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', 500),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-600-normal.woff2', 600),
    font('Ubuntu', 'ubuntu-latin-300-normal.woff2', 300),
    font('Ubuntu', 'ubuntu-latin-500-normal.woff2', 500),
  ],
  radius: 18,
  radii: { pill: 999, card: 18, modal: 16, row: 14, control: 10, chip: 8 },
  ease: { out: 'outExpo', inOut: 'inOutCubic', spring: 'outElastic(1, .7)' },
};
