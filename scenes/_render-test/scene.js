// Fixture for tests/render.test.mjs: red left half with a 1px white line at x=50, blue top-right quadrant,
// transparent bottom-right quadrant (so alpha is observable), a green marker that slides with t.
const div = (css) => `<div style="position:absolute;${css}"></div>`;
let mark;
export default {
  setup(ctx) {
    ctx.root.insertAdjacentHTML('beforeend',
      div('left:0;top:0;width:100px;height:100px;background:#f00') +
      div('left:50px;top:0;width:1px;height:100px;background:#fff') +
      div('left:100px;top:0;width:100px;height:50px;background:#00f') +
      div('left:0;top:90px;width:10px;height:10px;background:#0f0'));
    mark = ctx.root.lastElementChild;
  },
  render(t) { mark.style.left = t * 100 + 'px'; },
};
