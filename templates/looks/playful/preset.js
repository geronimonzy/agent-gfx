// look-playful: bright blue stage, candy colours, chunky rounded shapes, Fredoka. Fonts: the bundled style/fonts files
// (Fredoka, IBM Plex Mono: SIL OFL 1.1), latin subset.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'playful',
  colors: {
    bg: '#4f63ff',          // bright blue stage
    grid: '#5e70ff',        // background shapes (low contrast on bg)
    gridStrong: '#6c7dff',
    stroke: '#1f1a4d',      // outlines
    text: '#ffffff',        // type on the stage
    muted: '#c9d0ff',
    accent: '#ff4f9a',      // bubblegum pink: the one loud moment
    accentSoft: '#ff9cc6',
    surface: '#ffffff',     // cards / pills
    ink: '#1f1a4d',         // type on cards
    border: '#1f1a4d',
    shadow: '#2c37b8',      // hard offset shadows (no blur)
    sun: '#ffd23f',         // candy set for shapes: sun / mint / tangerine (+ accent)
    mint: '#2fe0a4',
    tangerine: '#ff8a3d',
  },
  fonts: {
    sans: "'Fredoka', 'Nunito', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    display: "'Fredoka', 'Nunito', system-ui, sans-serif",
  },
  fontFiles: [
    font('Fredoka', 'fredoka-latin-400-normal.woff2', 400),
    font('Fredoka', 'fredoka-latin-600-normal.woff2', 600),
    font('Fredoka', 'fredoka-latin-700-normal.woff2', 700),
    font('IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', 500),
  ],
  radius: 32,
  ease: { out: 'outBack(1.8)', inOut: 'inOutQuad', spring: 'outElastic(1, .5)' },
};
