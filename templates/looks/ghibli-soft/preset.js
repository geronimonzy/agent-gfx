// ghibli-soft: warm pastel sky, sage meadows, cream paper cards, one terracotta accent.
// Fonts: the bundled style/fonts files (Nunito: SIL OFL 1.1), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'ghibli-soft',
  colors: {
    bg: '#f5ead9',          // warm cream (the paper the sky is painted on)
    grid: '#ecdfca',
    gridStrong: '#e2d2ba',
    stroke: '#5a4a40',
    text: '#4e4038',        // warm brown ink, never black
    muted: '#8c7b6e',
    accent: '#e07f5f',      // terracotta / sunset coral: the one loud colour
    accentSoft: '#f4c2a6',
    surface: '#fff8ee',     // cream paper cards
    border: '#ead8c2',
    // painterly extras (CSS vars --gfx-sky-top etc.)
    skyTop: '#a8cbe0',      // soft sky blue
    skyMid: '#cfe0e6',
    skyLow: '#f8d9c2',      // peach haze at the horizon
    sun: '#fbe2ae',         // butter-yellow glow
    cloud: '#fffaf2',
    hillFar: '#c9dcc0',     // misty sage
    hillMid: '#a9c99f',
    hillNear: '#8db58a',    // meadow green
    petal: '#f6b8a8',       // drifting petals
    leaf: '#9cc18f',
    shadow: '#6b5446',      // soft warm shadow base (use with alpha)
  },
  fonts: {
    sans: "'Nunito', system-ui, sans-serif",
    mono: "'Nunito', ui-rounded, system-ui, sans-serif", // no rounded mono is bundled: numbers use Nunito too
  },
  fontFiles: [
    font('Nunito', 'nunito-latin-400-normal.woff2', 400),
    font('Nunito', 'nunito-latin-600-normal.woff2', 600),
    font('Nunito', 'nunito-latin-800-normal.woff2', 800),
  ],
  radius: 28,
  ease: { out: 'outCubic', inOut: 'inOutSine', spring: 'outBack(1.15)' },
};
