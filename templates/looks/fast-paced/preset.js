// look-fast-paced: black / white / acid yellow, Space Grotesk. Fonts: the bundled style/fonts files (Space Grotesk,
// IBM Plex Mono: SIL OFL 1.1), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'fast-paced',
  colors: {
    bg: '#0a0a0a',          // near-black stage
    grid: '#161616',
    gridStrong: '#222222',
    stroke: '#ffffff',
    text: '#ffffff',
    muted: '#9a9a9a',
    accent: '#e6ff00',      // acid yellow: whole-frame flashes, the number, the bar
    accentSoft: '#f3ff8a',
    accentInk: '#0a0a0a',   // text on an accent frame
    surface: '#ffffff',     // inverted (white) frames
    surfaceInk: '#0a0a0a',  // text on a white frame
    border: '#2a2a2a',
  },
  fonts: {
    sans: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif", // headlines: 700, uppercase, tight
  },
  fontFiles: [
    font('Space Grotesk', 'space-grotesk-latin-400-normal.woff2', 400),
    font('Space Grotesk', 'space-grotesk-latin-500-normal.woff2', 500),
    font('Space Grotesk', 'space-grotesk-latin-700-normal.woff2', 700),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', 500),
  ],
  radius: 0,
  ease: { out: 'outExpo', inOut: 'inOutExpo', spring: 'outBack(1.6)' },
};
