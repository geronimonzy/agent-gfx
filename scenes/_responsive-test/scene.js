// Fixture for --reframe: a green box filling the left half of whatever size the scene is built at, a blue strip
// along the bottom edge (so both dimensions are observable).
export default {
  setup(ctx) {
    const { width: w, height: h } = ctx;
    ctx.root.insertAdjacentHTML('beforeend',
      `<div style="position:absolute;left:0;top:0;width:${w / 2}px;height:${h - 20}px;background:#0f0"></div>` +
      `<div style="position:absolute;left:0;top:${h - 20}px;width:${w}px;height:20px;background:#00f"></div>`);
  },
  render() {},
};
