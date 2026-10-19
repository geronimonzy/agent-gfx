// editorial: warm paper, near-black ink, thin rules, one oxblood accent; Fraunces headlines over Inter text.
// Fonts: the bundled style/fonts files (Fraunces, Inter, IBM Plex Mono: SIL OFL 1.1), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'editorial',
  colors: {
    bg: '#f2ece0',          // warm uncoated paper
    grid: '#e7dfd0',        // column guides (barely there)
    gridStrong: '#dbd1bf',
    stroke: '#1d1b18',      // rules
    text: '#1d1b18',        // ink, a touch warm
    muted: '#6f675b',       // captions, folios
    accent: '#9e2f22',      // oxblood: the one colour
    accentSoft: '#d9b3a6',
    surface: '#f8f4ec',     // the turning page (lighter stock)
    border: '#cfc5b3',
    paperShade: '#e4dccc',  // page-turn shadow edge, deckled bands
    ink: '#1d1b18',
  },
  fonts: {
    sans: "'Inter', system-ui, sans-serif",
    serif: "'Fraunces', Georgia, 'Times New Roman', serif",
    display: "'Fraunces', Georgia, serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  fontFiles: [
    font('Fraunces', 'fraunces-latin-400-normal.woff2', 400),
    font('Fraunces', 'fraunces-latin-600-normal.woff2', 600),
    font('Fraunces', 'fraunces-latin-700-normal.woff2', 700),
    font('Inter', 'inter-latin-400-normal.woff2', 400),
    font('Inter', 'inter-latin-500-normal.woff2', 500),
    font('Inter', 'inter-latin-600-normal.woff2', 600),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', 400),
  ],
  radius: 0,
  ease: { out: 'outQuart', inOut: 'inOutQuart', spring: 'outQuart' },
};
