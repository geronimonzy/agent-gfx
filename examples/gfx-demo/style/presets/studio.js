// "studio" preset: the gfx studio's own dark theme (T3-style neutrals, brand blue), used to show agent-gfx in action.
// App chrome: bg..border, accent (= studio --primary), success / warning / markup / stem-* (studio tokens).
// The little "Tally" scene shown inside the mocked viewer uses the tally* keys so it reads as content, not chrome.
// Fonts: Inter and IBM Plex Mono (SIL OFL 1.1), served by the engine from /style/fonts.
const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });

export default {
  name: 'studio',
  colors: {
    bg: '#0a0a0a', // studio --background (neutral-950)
    grid: '#111111',
    gridStrong: '#161616',
    stroke: '#f5f5f5',
    text: '#f5f5f5',
    muted: '#858585',
    faint: '#4a4a4a',
    accent: '#346bf1', // studio --primary
    accentSoft: '#8eaaf8',
    accent2: '#00bc7d', // --success
    warning: '#fe9a00', // Claude badge
    surface: '#111111', // --card
    surfaceRaised: '#171717',
    chrome: '#0d0d0d',
    border: '#222222',
    input: '#262626',
    markup: '#ff4d6d', // --markup-1
    note: '#d0619b', // --stem-note
    hits: '#a3d65c',
    motion: '#f07a5a',
    ui: '#5ab8f0',
    accents: '#e0b04a',
    tallyBg: '#141b24',
    tallySurface: '#1d2630',
    tallyBorder: '#34404d',
    tallyAccent: '#2fb7a4',
    tallyAmber: '#e8a64a',
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
  radius: 10,
  ease: { out: 'outExpo', inOut: 'inOutCubic', spring: 'outElastic(1, .6)' },
};
