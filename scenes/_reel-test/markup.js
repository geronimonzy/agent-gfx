// Static DOM + CSS for _reel-test (Tally, a fictional receipt app; no cross-scene imports).
import { mulberry32 } from '/runner/lib/rng.js';

export const APP = { screen: '#121820', bezel: '#05070a' };
export const CHART = ['#2fb7a4', '#e8a64a', '#5b9be6', '#9ccc5a', '#d0619b'];
export const al = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

// phone: native 400x860, drawn at 1.6x -> 640x1376
export const PS = 1.6;
export const PHONE = { x: 220, y: 272, w: 400, h: 860, bezel: 10 };
export const SCREEN = { w: 380, h: 840 };
/** screen-local point -> frame coordinates (phone undistorted) */
export const toFrame = (x, y) => [PHONE.x + (PHONE.bezel - 1 + x) * PS, PHONE.y + (PHONE.bezel - 1 + y) * PS];

export const PAPER_ITEMS = [
  ['Oat milk 2×', '2.58'], ['Coffee beans 500g', '6.49'], ['Dish soap', '1.95'], ['Bananas', '1.79'],
  ['Wholegrain bread', '3.29'], ['Cheddar 200g', '4.79'], ['Olive oil', '9.99'], ['Laundry powder', '11.25'],
];
export const CARD_ITEMS = [
  { name: 'Oat milk 2×', short: 'Oat milk', price: '2.58', cat: 'dairy-eggs', tags: ['#organic'] },
  { name: 'Coffee beans 500g', short: 'Coffee beans', price: '6.49', cat: 'pantry', tags: ['#essential'] },
  { name: 'Dish soap', short: 'Dish soap', price: '1.95', cat: 'household', tags: [] },
  { name: 'Bananas', short: 'Bananas', price: '1.79', cat: 'fruit', tags: [] },
];
export const DONUT = [['Groceries', 30.12], ['Dining & Restaurants', 28.03], ['Household', 9.41], ['Drugstore', 5.27], ['Transport', 4.25]];
export const MEMBERS = [['Max', 'M'], ['Tom', 'T'], ['Lea', 'L'], ['You', 'You']];
export const SPLIT_ROWS = [['Coffee beans', '6.49', 1], ['Oat milk', '2.58', 2], ['Bananas', '1.79', 0], ['Dish soap', '1.95', 3]];
export const STATUS = ['finding…', 'straightening…', 'covering card numbers…', 'reading every line…', '8 lines · 4 categories'];

const ico = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
  check: ico('<path d="M5 12.5l4.2 4.2L19 7"/>', 'stroke-width="2.8"'),
  close: ico('<path d="M6 6l12 12M18 6L6 18"/>'),
  share: ico('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
};

export const logoSvg = (size, C) => `
  <svg class="logo" width="${size}" height="${size}" viewBox="0 0 26 26">
    <circle cx="13" cy="13" r="13" fill="${C.accent}"/>
    <path d="M8.5 7.5v11M11.5 7.5v11M14.5 7.5v11M17.5 7.5v11" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M6.5 16.5L19.5 9.5" stroke="${C.amber}" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;

/** polygon clip: straight top, zig-zag torn bottom */
export function torn(w, h, tooth = 14, depth = 9) {
  const pts = ['0px 0px', `${w}px 0px`, `${w}px ${h - depth}px`];
  const n = Math.ceil(w / tooth);
  for (let i = n; i >= 0; i--) pts.push(`${Math.min(w, i * tooth)}px ${i % 2 ? h : h - depth}px`);
  return `polygon(${pts.join(',')})`;
}

// ---- hook pile (6 receipts, seeded variety) ----------------------------------------------------
export const PILE = [
  { x: 215, y: 1130, z: -380, r: -15, b: 3.5 },
  { x: 870, y: 1090, z: -320, r: 12, b: 3 },
  { x: 380, y: 1280, z: -40, r: -8, b: 0 },
  { x: 720, y: 1330, z: 60, r: 9, b: 0 },
  { x: 540, y: 1060, z: 140, r: -3, b: 0 },
  { x: 560, y: 1340, z: 300, r: 5, b: 0 },
];
function pileHtml() {
  const rnd = mulberry32(2025);
  const shops = [['GREENLEAF', '112 Oak St'], ['PHARMA+', '40 Elm Ave'], ['FRESHWAY', '9 Hill Rd'], ['NORTHSIDE', '21 Bay St'], ['DAILY', '3 Pine Ct'], ['CORNER', '7 Mill Ln']];
  const things = ['Milk 1L', 'Bread', 'Apples', 'Pasta', 'Cheese', 'Yogurt', 'Rice', 'Tomatoes', 'Eggs x10', 'Butter', 'Coffee', 'Soap', 'Granola', 'Cucumber', 'Noodles', 'Juice'];
  return PILE.map((p, i) => {
    const n = 7 + Math.floor(rnd() * 9);
    const w = 330 + Math.floor(rnd() * 60);
    const lines = Array.from({ length: n }, () => {
      const nm = things[Math.floor(rnd() * things.length)];
      const pr = (0.6 + rnd() * 9).toFixed(2);
      return `<div class="rl"><span>${nm}</span><span>${pr}</span></div>`;
    }).join('');
    const [m, a] = shops[i];
    const blur = p.b ? `filter:blur(${p.b}px);` : '';
    return `<div class="fl pile" data-i="${i}"><div class="fi" style="${blur}"><div class="rc" style="width:${w}px"><div class="rcin">
      <div class="rm">${m}</div><div class="ra">${a}, Springfield</div><div class="rd"></div>${lines}<div class="rd"></div>
      <div class="rl rs"><span>TOTAL</span><span>${(14 + rnd() * 60).toFixed(2)}</span></div></div></div></div></div>`;
  }).join('');
}

// ---- phone screens -------------------------------------------------------------------------------
function paperHtml() {
  const L = (l, r) => `<div class="pl"><span>${l}</span><span>${r}</span><i class="hb"></i></div>`;
  return `<div class="paper"><div class="pin">
    <div class="pl"><span class="pm" style="width:100%">GREENLEAF</span><i class="hb"></i></div>
    <div class="pl pa" style="justify-content:center"><span>112 Oak St, Springfield · 19:47</span><i class="hb"></i></div>
    <div class="pd"></div>
    ${PAPER_ITEMS.map(([n, p]) => L(n, p)).join('')}
    <div class="pd"></div>
    <div class="pl"><b>TOTAL</b><b>42.13</b><i class="hb"></i></div>
    <div class="pd"></div>
    <div class="pl"><span>Card</span><span style="position:relative">**** 4821<i class="bar" style="left:-4px"></i></span></div>
    <div class="pl"><span>Rewards</span><span style="position:relative">3088 1172 …<i class="bar" style="left:-4px"></i></span></div>
  </div></div>`;
}
function cameraScreen() {
  return `<div class="scr s-cam cam">
    <div class="blob" style="left:-60px;top:120px;width:220px;height:220px;background:${al('#6a5a44', 0.45)}"></div>
    <div class="blob" style="left:230px;top:480px;width:200px;height:200px;background:${al('#2d3a4a', 0.6)}"></div>
    <div class="camtop">${ICONS.close}<span>SCAN</span><span style="width:20px"></span></div>
    <div class="vf">${paperHtml()}
      <i class="brk b0" style="border-top-width:3px;border-left-width:3px;border-top-left-radius:8px;transform-origin:0 0"></i>
      <i class="brk b1" style="border-top-width:3px;border-right-width:3px;border-top-right-radius:8px;transform-origin:100% 0"></i>
      <i class="brk b2" style="border-bottom-width:3px;border-right-width:3px;border-bottom-right-radius:8px;transform-origin:100% 100%"></i>
      <i class="brk b3" style="border-bottom-width:3px;border-left-width:3px;border-bottom-left-radius:8px;transform-origin:0 100%"></i>
      <i class="beam"></i>
    </div>
    <div class="status">${STATUS.map((s, i) => `<div>${i === 4 ? ICONS.check : ''}<span>${s}</span></div>`).join('')}</div>
  </div>`;
}
function cardScreen() {
  const items = CARD_ITEMS.map((it) => `<div class="item"><div class="row"><span class="n">${it.name}</span><span class="leader"></span><span class="p num">${it.price}</span></div>
      <div class="chips"><span class="chip">${it.cat}</span>${it.tags.map((c) => `<span class="chip tag">${c}</span>`).join('')}</div></div>`).join('');
  return `<div class="scr s-card"><div class="pad">
    <div class="rhead"><span>RECEIPT · <span class="acc">COMPLETED</span></span><span class="x">EXPORT</span></div>
    <div class="rcard">
      <div class="mer">GREENLEAF</div>
      <div class="dt">Jul 14, 2026 · 19:47 · Springfield</div>
      <div class="dash" style="margin:12px 0 4px"></div>
      ${items}
      <div class="more">+ 4 more items</div>
      <div class="tot"><span>Subtotal</span><span class="num">$42.13</span></div>
      <div class="tot"><span>Tax · incl. 7 %</span><span class="num">$2.76</span></div>
      <div class="tot big"><span>Total</span><span class="num">$42.13</span></div>
    </div>
  </div></div>`;
}
function analyticsScreen(C) {
  const R = 62;
  let acc = 0;
  const total = DONUT.reduce((s, d) => s + d[1], 0);
  const segs = DONUT.map(([, v], i) => {
    const len = (v / total) * 100;
    const start = acc;
    acc += len;
    return `<circle class="dseg" cx="80" cy="80" r="${R}" fill="none" stroke="${CHART[i]}" stroke-width="20" pathLength="100"
      stroke-dasharray="${(len - 0.8).toFixed(2)} 200" stroke-dashoffset="${(len - 0.8).toFixed(2)}" data-len="${(len - 0.8).toFixed(2)}"
      transform="rotate(${-90 + start * 3.6} 80 80)"/>`;
  }).join('');
  const fmt = (v) => '$' + v.toFixed(2);
  return `<div class="scr s-ana"><div class="pad" style="padding-top:62px">
    <div class="eyebrow">July 2026</div><div class="title">ANALYTICS</div>
    <div class="card acard a1">
      <div class="ct"><span>JULY BUDGET</span><span class="g">Goals →</span></div>
      <div style="display:flex;align-items:center;gap:20px;margin-top:12px">
        <div class="gauge">
          <svg width="150" height="150" viewBox="0 0 150 150">
            <circle cx="75" cy="75" r="62" fill="none" stroke="#2a2e3a" stroke-width="12"/>
            <circle class="ring" cx="75" cy="75" r="62" fill="none" stroke="${C.accent}" stroke-width="12" stroke-linecap="round"
              pathLength="100" stroke-dasharray="100 200" stroke-dashoffset="100" transform="rotate(-90 75 75)"/>
          </svg>
          <div class="c"><div class="v num g-val">$0.00</div><div class="o">of <span class="num">$500.00</span></div></div>
        </div>
        <div><span class="num g-pct" style="font:500 40px var(--n);color:${C.text}">0%</span><span style="font:500 15px var(--gfx-font-sans)"> used</span>
          <div class="sub" style="margin-top:6px">13 days left</div></div>
      </div>
    </div>
    <div class="card acard a2">
      <div class="ct"><span>WHERE IT GOES</span><span class="num" style="letter-spacing:0;font-size:14px;color:${C.text}">${fmt(total)}</span></div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:10px">
        <svg width="132" height="132" viewBox="0 0 160 160" style="flex:none"><circle cx="80" cy="80" r="${R}" fill="none" stroke="#2a2e3a" stroke-width="20"/>${segs}</svg>
        <div style="flex:1">${DONUT.map(([n, v], i) => `<div class="leg"><i style="background:${CHART[i]}"></i><span>${n.replace('Dining & Restaurants', 'Dining')}</span><span class="leader"></span><span class="num">${fmt(v)}</span></div>`).join('')}</div>
      </div>
    </div>
    <div class="pill pri b-share" style="height:50px;margin-top:16px;gap:8px;font-size:16px">${ICONS.share}<span>Share with group</span></div>
  </div></div>`;
}
function splitScreen() {
  const nm = (i) => (MEMBERS[i][1] === 'You' ? 'Y' : MEMBERS[i][1]);
  return `<div class="scr s-split"><div class="pad" style="padding-top:62px">
    <div class="eyebrow">SPLIT · GREENLEAF</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="title">4 PEOPLE</div><div class="num" style="font:500 24px var(--n)">$42.13</div></div>
    <div class="sub" style="margin-top:8px">Tap items to claim them</div>
    <div class="mrow">${MEMBERS.map(([n], i) => `<div class="mchip"><span class="av ${n === 'You' ? 'me' : ''}">${nm(i)}</span>${n}</div>`).join('')}</div>
    <div style="margin-top:10px">${SPLIT_ROWS.map(([n, p, w]) => `<div class="srow"><span class="n">${n}</span><span class="p num">$${p}</span>
      <div class="slot"><div class="pill ghost claim">Claim</div><span class="av ${w === 3 ? 'me' : ''}">${nm(w)}</span></div></div>`).join('')}</div>
    <div class="sfoot"><div class="pill pri" style="height:46px;padding:0 26px;font-size:15px">Lock split</div></div>
  </div></div>`;
}

export function css(style) {
  const C = style.colors;
  const F = style.fonts;
  return `<style>
    :where(#gfx-root *){box-sizing:border-box;margin:0;padding:0}
    .layer{position:absolute;inset:0}
    .shake{position:absolute;inset:0}
    .glow{position:absolute;width:1500px;height:1500px;left:-210px;top:210px}
    .glow i{position:absolute;inset:0;border-radius:50%;background:radial-gradient(closest-side, ${al(C.glow, 0.34)}, ${al(C.glow, 0.1)} 48%, ${al(C.glow, 0)} 100%)}
    .stage{position:absolute;inset:0;perspective:1800px;perspective-origin:50% 50%}
    .drift{position:absolute;inset:0;transform-style:preserve-3d}
    .fl{position:absolute;left:0;top:0;opacity:0;will-change:transform}
    .fd{position:absolute;left:0;top:0}
    .fi{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap}
    .acc{color:${C.accent}}

    /* hook */
    .rc{background:${C.paper};color:${C.ink};filter:drop-shadow(0 24px 30px #000000aa)}
    .rcin{padding:30px 26px 40px;font:400 21px/1.55 ${F.mono}}
    .rm{font:600 40px ${F.mono};text-align:center;letter-spacing:.06em}
    .ra{text-align:center;font-size:17px;margin-bottom:8px}
    .rd{border-top:2px dashed ${al(C.ink, 0.45)};margin:10px 0}
    .rl{display:flex;justify-content:space-between}
    .rs{font-weight:600;font-size:26px}
    .hook{position:absolute;left:0;right:0;top:290px;text-align:center;font:700 138px/1.02 ${F.sans};letter-spacing:-.025em;color:${C.text};
      text-shadow:0 10px 50px ${al('#000000', 0.55)}}
    .hook span{display:inline-block;opacity:0}
    .hook .q{color:${C.accentSoft}}

    /* phone */
    .ph{position:absolute;left:${PHONE.x}px;top:${PHONE.y}px;width:${PHONE.w * PS}px;height:${PHONE.h * PS}px;opacity:0}
    .phs{position:absolute;left:0;top:0;width:${PHONE.w}px;height:${PHONE.h}px;transform:scale(${PS});transform-origin:0 0;
      border-radius:56px;background:${APP.bezel};border:1px solid ${C.border};box-shadow:0 30px 80px ${al('#000000', 0.6)}, 0 0 90px ${al(C.glow, 0.35)}}
    .screen{position:absolute;left:${PHONE.bezel - 1}px;top:${PHONE.bezel - 1}px;width:${SCREEN.w}px;height:${SCREEN.h}px;
      border-radius:46px;overflow:hidden;background:${APP.screen};color:${C.text};font:400 14px ${F.sans};isolation:isolate}
    .island{position:absolute;left:${SCREEN.w / 2 - 52}px;top:11px;width:104px;height:30px;border-radius:15px;background:#000;z-index:50}
    .sbar{position:absolute;left:0;right:0;top:0;height:50px;z-index:49;display:flex;justify-content:space-between;align-items:center;padding:4px 30px 0 36px;font:600 15px ${F.sans}}
    .scr{position:absolute;inset:0;opacity:0}
    .pad{padding:0 20px}
    .eyebrow{font:500 11px ${F.sans};letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
    .title{font:500 31px ${F.sans};letter-spacing:.07em;margin-top:4px}
    .sub{font:400 13.5px ${F.sans};color:${C.muted};margin-top:4px}
    .num{font-family:${F.num};font-variant-numeric:tabular-nums}
    .card{border:1px solid ${C.border};border-radius:18px;background:${C.surface}}
    .pill{border-radius:999px;display:flex;align-items:center;justify-content:center;font:600 14px ${F.sans}}
    .pill.pri{background:${C.accent};color:#0b2421;box-shadow:0 6px 24px ${al(C.glow, 0.35)}}
    .pill.ghost{border:1px solid ${al(C.accent, 0.55)};color:${C.accentSoft};background:${al(C.accent, 0.06)}}
    .chip{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:999px;font:400 12px ${F.sans};border:1px solid ${C.border};color:${C.muted}}
    .chip.tag{border-color:transparent;background:${al(C.accent, 0.16)};color:${C.accentSoft}}
    .dash{border-top:1px dashed ${C.border}}
    .leader{flex:1;border-bottom:1px dotted ${al(C.muted, 0.45)};margin:0 8px;transform:translateY(-4px)}
    .row{display:flex;align-items:baseline}
    .av{width:26px;height:26px;border-radius:50%;border:1.5px solid ${C.text};display:flex;align-items:center;justify-content:center;font:500 11px ${F.sans};color:${C.text};flex:none}
    .av.me{border-color:${C.accent};color:${C.accentSoft};background:${al(C.accent, 0.14)}}
    .cam{background:radial-gradient(120% 80% at 40% 40%, #3a3631 0%, #24221f 45%, #121214 100%)}
    .blob{position:absolute;border-radius:50%;filter:blur(30px)}
    .vf{position:absolute;left:0;right:0;top:0;height:700px}
    .paper{position:absolute;width:236px;filter:drop-shadow(0 16px 22px #00000099)}
    .paper .pin{background:${C.paper};color:${C.ink};font:400 10.5px/1.62 ${F.mono};padding:18px 16px 26px}
    .paper .pm{font:600 20px ${F.mono};text-align:center;letter-spacing:.08em}
    .paper .pa{text-align:center;font-size:9.5px;margin-bottom:8px}
    .paper .pl{position:relative;display:flex;justify-content:space-between;white-space:pre}
    .paper .hb{position:absolute;left:-6px;right:-6px;top:0;bottom:0;background:${al(C.accent, 0.42)};opacity:0;border-radius:3px}
    .paper .bar{position:absolute;top:2px;bottom:2px;right:-2px;background:#000;transform-origin:0 50%;border-radius:2px}
    .paper .pd{border-top:1px dashed ${al(C.ink, 0.5)};margin:7px 0}
    .brk{position:absolute;left:0;top:0;width:30px;height:30px;border:0 solid ${C.accent};opacity:0;filter:drop-shadow(0 0 6px ${al(C.accent, 0.8)})}
    .beam{position:absolute;left:0;top:0;height:3px;border-radius:2px;background:${C.accentSoft};opacity:0;box-shadow:0 0 14px 4px ${al(C.accent, 0.7)}, 0 0 50px 14px ${al(C.glow, 0.35)}}
    .status{position:absolute;left:0;right:0;top:748px;height:30px;font:600 19px ${F.mono};color:${C.accentSoft};text-align:center}
    .status div{position:absolute;left:0;right:0;opacity:0;display:flex;white-space:nowrap;justify-content:center;align-items:center;gap:7px}
    .status svg{width:20px;height:20px;color:${C.accent}}
    .camtop{position:absolute;top:58px;left:20px;right:20px;display:flex;justify-content:space-between;align-items:center;z-index:5;font:500 11px ${F.sans};letter-spacing:.16em;color:${al(C.text, 0.8)}}
    .camtop svg{width:20px;height:20px}
    .rhead{display:flex;justify-content:space-between;align-items:center;margin-top:62px;font:500 12.5px ${F.sans};letter-spacing:.14em;color:${C.muted}}
    .rhead .x{color:${C.accent};font-size:11px}
    .rcard{margin-top:16px;padding:20px 18px 14px;border:1px solid ${al(C.text, 0.85)};border-radius:18px;background:${C.surface}}
    .rcard .mer{font:600 22px ${F.mono};letter-spacing:.04em}
    .rcard .dt{font:400 11.5px ${F.mono};color:${C.muted};margin-top:4px}
    .item{padding:12px 0;border-bottom:1px dashed ${al(C.border, 0.6)}}
    .item .n{font:400 13.5px ${F.mono}}
    .item .p{font:400 14px ${F.num}}
    .item .chips{display:flex;gap:6px;margin-top:8px}
    .more{font:400 12px ${F.mono};color:${C.muted};padding:10px 0}
    .tot{display:flex;justify-content:space-between;align-items:baseline;font:400 13.5px ${F.mono};color:${C.muted};margin-top:8px}
    .tot.big{color:${C.text};font-weight:600;margin-top:12px}
    .tot.big .num{font:500 26px ${F.num};color:${C.text}}
    .acard{margin-top:16px;padding:16px}
    .acard .ct{display:flex;justify-content:space-between;font:500 12px ${F.sans};letter-spacing:.14em;color:${C.muted}}
    .acard .ct .g{letter-spacing:0;font-size:14px;color:${C.accent}}
    .gauge{position:relative;width:150px;height:150px}
    .gauge .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .gauge .v{font:500 26px ${F.num};letter-spacing:-.01em}
    .gauge .o{font:400 12px ${F.sans};color:${C.muted};margin-top:2px}
    .leg{display:flex;align-items:center;font:400 12px ${F.sans};margin-top:7px}
    .leg:first-child{margin-top:0}
    .leg i{width:9px;height:9px;border-radius:3px;margin-right:7px;flex:none}
    .mrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
    .mchip{display:flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 4px;border-radius:999px;border:1px solid ${C.border};font:400 13px ${F.sans}}
    .srow{display:flex;align-items:center;height:62px;border-bottom:1px solid ${al(C.border, 0.6)}}
    .srow .n{flex:1;font:400 15px ${F.sans}}
    .srow .p{font:400 14px ${F.num};margin-right:12px}
    .slot{position:relative;width:74px;height:34px}
    .slot .pill{position:absolute;inset:0;font-size:13.5px}
    .slot .av{position:absolute;left:24px;top:3px;width:28px;height:28px;opacity:0;background:${APP.screen}}
    .sfoot{margin-top:24px}
    .tap{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;z-index:60}
    .tap i{position:absolute;inset:0;border-radius:50%;opacity:0}
    .tap .dot{background:${al('#ffffff', 0.4)}}
    .tap .ring{border:2px solid ${al('#ffffff', 0.75)}}

    /* floating chips */
    .fc{display:inline-flex;align-items:center;gap:14px;padding:14px 18px 14px 26px;border-radius:26px;background:${C.surface};border:2px solid ${C.border};
      font:600 34px ${F.sans};color:${C.text};box-shadow:0 24px 60px ${al('#000000', 0.55)}, 0 0 40px ${al(C.glow, 0.25)}}
    .fc .pr{font:500 34px ${F.num};color:${C.muted}}
    .fc .ct{padding:6px 18px;border-radius:999px;background:${C.accent};color:#0b2421;font:600 28px ${F.sans}}
    .fc.tg{background:${al(C.accent, 0.22)};border-color:${C.accent};color:${C.accentSoft};padding:12px 28px;font-size:36px}
    .total{font:500 250px/1 ${F.num};color:${al(C.text, 0.92)};text-shadow:0 14px 70px ${al('#000000', 0.7)}, 0 0 80px ${al(C.glow, 0.5)};letter-spacing:-.02em}
    .lbl{font:600 70px ${F.sans};color:${C.text};padding:14px 38px;border-radius:999px;background:${al(C.bg, 0.88)};border:2px solid ${C.accent};
      box-shadow:0 0 60px ${al(C.glow, 0.5)}}
    .circ{width:128px;height:128px;border-radius:50%;border:6px solid ${C.text};background:${C.surface};display:flex;align-items:center;justify-content:center;
      font:700 54px ${F.sans};color:${C.text};box-shadow:0 20px 60px ${al('#000000', 0.5)}, 0 0 50px ${al(C.glow, 0.45)}}
    .circ.me{border-color:${C.accent};color:${C.accentSoft}}
    .avn{text-align:center;font:600 36px ${F.sans};margin-top:12px;color:${C.text}}
    .dpill{margin:10px auto 0;display:flex;align-items:center;gap:8px;width:max-content;padding:8px 22px;border-radius:999px;background:${C.accent};color:#0b2421;
      font:700 28px ${F.sans};letter-spacing:.1em;opacity:0}
    .dpill svg{width:28px;height:28px}
    .each{font:500 124px ${F.num};color:${C.text};text-shadow:0 10px 50px ${al('#000000', 0.7)}}
    .each small{font:600 70px ${F.sans};color:${C.accentSoft};margin-left:14px}

    /* floods */
    .flood{position:absolute;inset:0;clip-path:circle(0px at 50% 50%);pointer-events:none}
    .flood.deep{background:${C.accentDeep}}
    .flood.main{background:${C.accent}}
    .verb{position:absolute;left:0;right:0;top:760px;text-align:center;font:700 300px/1 ${F.sans};letter-spacing:-.02em;color:${C.bg};text-transform:uppercase;opacity:0}

    /* end card */
    .end{position:absolute;inset:0;pointer-events:none;color:${C.text}}
    .front{position:absolute;inset:0}
    .lockup{position:absolute;left:0;right:0;top:350px;display:flex;justify-content:center;align-items:center;gap:34px}
    .lockup .word{font:600 104px ${F.mono};letter-spacing:.04em;opacity:0}
    .endLogo{opacity:0;filter:drop-shadow(0 0 50px ${al(C.glow, 0.8)})}
    .tag1{position:absolute;left:0;right:0;top:640px;text-align:center;font:700 108px/1.08 ${F.sans};letter-spacing:-.02em}
    .w{display:inline-block;overflow:hidden;vertical-align:top;padding:0 .04em .12em;margin-bottom:-.12em}
    .w>span{display:inline-block;transform:translateY(115%)}
    .url{position:absolute;left:0;right:0;top:960px;text-align:center;font:700 124px/1 ${F.sans};letter-spacing:-.03em;opacity:0}
    .url span{position:relative;display:inline-block}
    .url .ul{position:absolute;left:6px;right:6px;bottom:-26px;height:12px;border-radius:6px;background:${C.accent};transform-origin:0 50%;transform:scaleX(0);
      box-shadow:0 0 34px ${al(C.glow, 0.9)}}
    .cta{position:absolute;left:0;right:0;top:1250px;margin:0 auto;width:max-content;height:128px;padding:0 64px;font:700 58px ${F.sans};opacity:0;
      box-shadow:0 10px 60px ${al(C.glow, 0.6)}}
    .fine{position:absolute;left:0;right:0;top:1420px;text-align:center;font:500 34px ${F.sans};color:${C.muted};opacity:0}
  </style>`;
}

export function html(style) {
  const C = style.colors;
  const w = (s) => `<span class="w"><span>${s}</span></span>`;
  return `${css(style)}
  <div class="layer grid"></div>
  <div class="glow"><i></i></div>
  <div class="shake">
    <div class="stage"><div class="drift">
      ${pileHtml()}
      <div class="ph"><div class="phs"><div class="screen">
        <div class="island"></div><div class="sbar"><span>9:41</span><span></span></div>
        ${cameraScreen()}${cardScreen()}${analyticsScreen(C)}${splitScreen()}
        <div class="tap"><i class="dot"></i><i class="ring"></i></div>
      </div></div></div>
      <div class="floats"></div>
    </div></div>
    <div class="front"></div>
    <div class="hook"><span>Tired</span> <span>of</span><br/><span class="q">these?</span></div>
    <div class="fl lblwrap"><div class="fi"><div class="lbl">Know where it goes.</div></div></div>
    <div class="end">
      <div class="lockup"><div class="endLogo">${logoSvg(180, C)}</div><div class="word">TALLY</div></div>
      <div class="tag1">${w('Your')} ${w('receipts,')}<br/>${w('<span class="acc">TALLIED.</span>')}</div>
      <div class="url"><span>tally.example<i class="ul"></i></span></div>
      <div class="pill pri cta">Get started →</div>
      <div class="fine">Made for the test suite</div>
    </div>
  </div>
  <div class="flood deep"></div>
  <div class="flood main"><div class="verb v0">Snap.</div><div class="verb v1">Sort.</div><div class="verb v2">Split.</div></div>`;
}
