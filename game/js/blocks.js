// Block registry and procedural pixel-art texture atlas.
(function () {
  const T = { // tile indices in the atlas (16 columns)
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG_SIDE: 6, LOG_TOP: 7,
    LEAVES: 8, PLANKS: 9, COBBLE: 10, BEDROCK: 11, GRAVEL: 12, SNOW_TOP: 13, SNOW_SIDE: 14,
    COAL: 15, IRON: 16, GOLD: 17, SHARD: 18, GLASS: 19, BRICK: 20, MOB_BODY: 21, MOB_FACE: 22,
    CLOUD: 23, CRACK0: 24, CRACK1: 25, CRACK2: 26, CRACK3: 27, LANTERN: 28, MOB_BACK: 29,
    BOOKSHELF: 30, MOSSY: 31, WHITE: 32
  };
  const ATLAS_COLS = 16, ATLAS_ROWS = 4, TILE = 16;

  // id -> definition
  const B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7, PLANKS: 8,
    COBBLE: 9, BEDROCK: 10, GRAVEL: 11, SNOW: 12, COAL_ORE: 13, IRON_ORE: 14, GOLD_ORE: 15,
    SHARD: 16, GLASS: 17, BRICK: 18, LANTERN: 19, BOOKSHELF: 20, MOSSY: 21
  };
  const DEF = [];
  function def(id, name, tiles, opts) {
    DEF[id] = Object.assign({
      id, name, top: tiles[0], side: tiles[1], bottom: tiles[2] !== undefined ? tiles[2] : tiles[0],
      solid: true, liquid: false, transparent: false, hardness: 1, drop: id, glow: 0, placeable: true
    }, opts || {});
  }
  def(B.AIR, 'Air', [0, 0, 0], { solid: false, transparent: true, placeable: false });
  def(B.GRASS, 'Grass', [T.GRASS_TOP, T.GRASS_SIDE, T.DIRT], { hardness: 0.6, drop: B.DIRT });
  def(B.DIRT, 'Dirt', [T.DIRT, T.DIRT], { hardness: 0.5 });
  def(B.STONE, 'Stone', [T.STONE, T.STONE], { hardness: 1.5, drop: B.COBBLE });
  def(B.SAND, 'Sand', [T.SAND, T.SAND], { hardness: 0.5 });
  def(B.WATER, 'Water', [T.WATER, T.WATER], { solid: false, liquid: true, transparent: true, placeable: false, hardness: 0 });
  def(B.LOG, 'Oak Log', [T.LOG_TOP, T.LOG_SIDE], { hardness: 1.0 });
  def(B.LEAVES, 'Leaves', [T.LEAVES, T.LEAVES], { hardness: 0.25 });
  def(B.PLANKS, 'Planks', [T.PLANKS, T.PLANKS], { hardness: 1.0 });
  def(B.COBBLE, 'Cobblestone', [T.COBBLE, T.COBBLE], { hardness: 1.6 });
  def(B.BEDROCK, 'Bedrock', [T.BEDROCK, T.BEDROCK], { hardness: Infinity, placeable: false });
  def(B.GRAVEL, 'Gravel', [T.GRAVEL, T.GRAVEL], { hardness: 0.6 });
  def(B.SNOW, 'Snow', [T.SNOW_TOP, T.SNOW_SIDE, T.DIRT], { hardness: 0.5 });
  def(B.COAL_ORE, 'Coal Ore', [T.COAL, T.COAL], { hardness: 2.0 });
  def(B.IRON_ORE, 'Iron Ore', [T.IRON, T.IRON], { hardness: 2.5 });
  def(B.GOLD_ORE, 'Gold Ore', [T.GOLD, T.GOLD], { hardness: 2.5 });
  def(B.SHARD, 'Ember Shard', [T.SHARD, T.SHARD], { hardness: 0.2, glow: 1, placeable: false, transparent: true });
  def(B.GLASS, 'Glass', [T.GLASS, T.GLASS], { hardness: 0.4, transparent: true });
  def(B.BRICK, 'Brick', [T.BRICK, T.BRICK], { hardness: 1.5 });
  def(B.LANTERN, 'Lantern', [T.LANTERN, T.LANTERN], { hardness: 0.4, glow: 1 });
  def(B.BOOKSHELF, 'Bookshelf', [T.PLANKS, T.BOOKSHELF, T.PLANKS], { hardness: 1.0 });
  def(B.MOSSY, 'Mossy Stone', [T.MOSSY, T.MOSSY], { hardness: 1.6 });

  // ---------- Texture atlas generation ----------
  function buildAtlas() {
    const W = ATLAS_COLS * TILE, H = ATLAS_ROWS * TILE;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H); const d = img.data;
    const rnd = Noise.mulberry32(1337);
    const n2 = new Noise.Simplex(99);

    function px(tile, x, y, r, g, b, a) {
      const tx = (tile % ATLAS_COLS) * TILE + x, ty = Math.floor(tile / ATLAS_COLS) * TILE + y;
      const i = (ty * W + tx) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a === undefined ? 255 : a;
    }
    function getpx(tile, x, y) {
      const tx = (tile % ATLAS_COLS) * TILE + x, ty = Math.floor(tile / ATLAS_COLS) * TILE + y;
      const i = (ty * W + tx) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    // fill with base color + random brightness jitter
    function fill(tile, col, jitter, fn) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let j = (rnd() - 0.5) * 2 * jitter;
        let c = [col[0] + j, col[1] + j, col[2] + j, 255];
        if (fn) c = fn(x, y, c, j) || c;
        px(tile, x, y, clamp(c[0]), clamp(c[1]), clamp(c[2]), c[3]);
      }
    }
    function speck(tile, col, count, size) {
      for (let i = 0; i < count; i++) {
        const x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
          const j = (rnd() - 0.5) * 20;
          px(tile, (x + dx) % TILE, (y + dy) % TILE, clamp(col[0] + j), clamp(col[1] + j), clamp(col[2] + j));
        }
      }
    }
    function copy(from, to) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const c = getpx(from, x, y); px(to, x, y, c[0], c[1], c[2], c[3]); } }
    function stone(tile, base) {
      fill(tile, base, 10, (x, y, c) => {
        const v = n2.noise2D(x * 0.35 + tile * 7, y * 0.35) * 18;
        return [c[0] + v, c[1] + v, c[2] + v, 255];
      });
      speck(tile, [base[0] - 22, base[1] - 22, base[2] - 22], 10, 2);
    }

    // grass top
    fill(T.GRASS_TOP, [98, 158, 62], 14, (x, y, c) => { const v = n2.noise2D(x * 0.5, y * 0.5) * 12; return [c[0] + v, c[1] + v, c[2] + v * 0.5, 255]; });
    // dirt
    fill(T.DIRT, [128, 92, 62], 16); speck(T.DIRT, [100, 70, 45], 14, 2); speck(T.DIRT, [150, 112, 78], 8, 1);
    // grass side: dirt with grass fringe
    copy(T.DIRT, T.GRASS_SIDE);
    for (let x = 0; x < TILE; x++) {
      const depth = 2 + Math.floor(rnd() * 3);
      for (let y = 0; y < depth; y++) { const j = (rnd() - 0.5) * 24; px(T.GRASS_SIDE, x, y, clamp(96 + j), clamp(156 + j), clamp(60 + j * 0.5)); }
    }
    stone(T.STONE, [128, 128, 128]);
    // sand
    fill(T.SAND, [219, 208, 160], 12); speck(T.SAND, [200, 188, 140], 10, 1);
    // water
    fill(T.WATER, [46, 92, 200], 6, (x, y, c) => { const v = n2.noise2D(x * 0.4 + 40, y * 0.4) * 22; return [c[0] + v * 0.5, c[1] + v, c[2] + v, 175]; });
    // log side
    fill(T.LOG_SIDE, [104, 80, 48], 8, (x, y, c) => { const s = (x % 4 === 0 || (x + 2) % 5 === 0) ? -22 : 0; const v = n2.noise2D(x * 0.3, y * 0.8) * 8; return [c[0] + s + v, c[1] + s + v, c[2] + s + v, 255]; });
    // log top: rings
    fill(T.LOG_TOP, [160, 128, 80], 6, (x, y, c) => {
      const dx = x - 7.5, dy = y - 7.5; const r = Math.sqrt(dx * dx + dy * dy);
      const ring = (Math.floor(r * 1.2) % 2 === 0) ? 18 : -10; const bark = r > 6.8 ? -60 : 0;
      return [c[0] + ring + bark, c[1] + ring + bark, c[2] + ring + bark, 255];
    });
    // leaves
    fill(T.LEAVES, [52, 120, 40], 20, (x, y, c) => { const v = n2.noise2D(x * 0.6 + 80, y * 0.6) * 24; return [c[0] + v * 0.6, c[1] + v, c[2] + v * 0.4, 255]; });
    speck(T.LEAVES, [30, 82, 26], 20, 1);
    // planks
    fill(T.PLANKS, [178, 142, 86], 8, (x, y, c) => {
      const row = Math.floor(y / 4); const seam = (y % 4 === 3) ? -40 : 0;
      const off = (row % 2) * 8; const vseam = ((x + off) % 16 === 0) ? -40 : 0;
      const v = n2.noise2D(x * 0.7, y * 0.2 + row * 10) * 8;
      return [c[0] + seam + vseam + v, c[1] + seam + vseam + v, c[2] + seam + vseam + v, 255];
    });
    // cobble
    fill(T.COBBLE, [120, 120, 120], 10, (x, y, c) => {
      const v = n2.noise2D(x * 0.9 + 200, y * 0.9) ; const cell = v > 0.25 ? 20 : (v < -0.3 ? -30 : 0);
      return [c[0] + cell, c[1] + cell, c[2] + cell, 255];
    });
    // bedrock
    stone(T.BEDROCK, [70, 70, 70]); speck(T.BEDROCK, [30, 30, 30], 12, 2);
    // gravel
    fill(T.GRAVEL, [130, 126, 120], 20); speck(T.GRAVEL, [90, 88, 84], 14, 2); speck(T.GRAVEL, [170, 165, 160], 10, 1);
    // snow
    fill(T.SNOW_TOP, [240, 244, 250], 6);
    copy(T.DIRT, T.SNOW_SIDE);
    for (let x = 0; x < TILE; x++) { const depth = 3 + Math.floor(rnd() * 3); for (let y = 0; y < depth; y++) { const j = (rnd() - 0.5) * 10; px(T.SNOW_SIDE, x, y, clamp(238 + j), clamp(242 + j), clamp(248 + j)); } }
    // ores
    function ore(tile, col) {
      copy(T.STONE, tile);
      for (let i = 0; i < 6; i++) {
        const x = 1 + Math.floor(rnd() * 13), y = 1 + Math.floor(rnd() * 13);
        const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [rnd() < 0.5 ? -1 : 2, rnd() < 0.5 ? 0 : 1]];
        for (const [dx, dy] of shape) { const j = (rnd() - 0.5) * 30; px(tile, (x + dx + 16) % 16, (y + dy + 16) % 16, clamp(col[0] + j), clamp(col[1] + j), clamp(col[2] + j)); }
      }
    }
    ore(T.COAL, [30, 30, 32]); ore(T.IRON, [216, 170, 140]); ore(T.GOLD, [250, 210, 60]);
    // shard: glowing ember crystal
    fill(T.SHARD, [255, 120, 30], 0, (x, y) => {
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
      const dia = dx * 0.8 + dy;
      if (dia > 7.5) return [0, 0, 0, 0];
      const core = dia < 3 ? 1 : 0;
      const j = n2.noise2D(x * 0.8, y * 0.8) * 30;
      return [255, 150 + core * 80 + j, 40 + core * 120 + j, 255];
    });
    // glass
    fill(T.GLASS, [220, 240, 250], 0, (x, y) => {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) return [200, 220, 235, 230];
      const streak = (x + y) % 9 === 0 && x < 8;
      return streak ? [255, 255, 255, 150] : [220, 240, 250, 55];
    });
    // brick
    fill(T.BRICK, [150, 74, 60], 10, (x, y, c) => {
      const row = Math.floor(y / 4); const off = (row % 2) * 4;
      const mortar = (y % 4 === 3) || ((x + off) % 8 === 7);
      if (mortar) return [166, 158, 150, 255];
      const v = n2.noise2D(x * 0.5 + row * 3, y * 0.5 + 300) * 12;
      return [c[0] + v, c[1] + v * 0.6, c[2] + v * 0.5, 255];
    });
    // mob body: dark shadowy purple
    fill(T.MOB_BODY, [40, 28, 58], 14, (x, y, c) => { const v = n2.noise2D(x * 0.5 + 500, y * 0.5) * 18; return [c[0] + v, c[1] + v * 0.5, c[2] + v, 255]; });
    copy(T.MOB_BODY, T.MOB_FACE); copy(T.MOB_BODY, T.MOB_BACK);
    // eyes
    for (const ex of [3, 10]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 3; dx++) px(T.MOB_FACE, ex + dx, 5 + dy, 255, 60, 60);
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) px(T.MOB_FACE, 7 + dx, 9 + dy, 20, 8, 30);
    // cloud
    fill(T.CLOUD, [255, 255, 255], 0, () => [255, 255, 255, 190]);
    // cracks
    for (let s = 0; s < 4; s++) {
      const tile = T.CRACK0 + s;
      fill(tile, [0, 0, 0], 0, () => [0, 0, 0, 0]);
      const cracks = 3 + s * 3;
      for (let c = 0; c < cracks; c++) {
        let x = Math.floor(rnd() * 16), y = Math.floor(rnd() * 16);
        const len = 3 + Math.floor(rnd() * 6);
        for (let i = 0; i < len; i++) {
          px(tile, x & 15, y & 15, 20, 20, 20, 180 + s * 20);
          if (rnd() < 0.5) x += rnd() < 0.5 ? 1 : -1; else y += rnd() < 0.5 ? 1 : -1;
        }
      }
    }
    // lantern
    fill(T.LANTERN, [255, 214, 120], 10, (x, y, c) => {
      const edge = x === 0 || y === 0 || x === 15 || y === 15 || (x % 5 === 0) || (y % 5 === 0);
      if (edge) return [60, 44, 30, 255];
      const v = n2.noise2D(x * 0.7, y * 0.7 + 900) * 30; return [255, c[1] + v, c[2] + v, 255];
    });
    // bookshelf
    copy(T.PLANKS, T.BOOKSHELF);
    for (const row of [2, 9]) {
      let x = 1;
      while (x < 15) {
        const w = 1 + Math.floor(rnd() * 2); const cols = [[170, 50, 50], [50, 90, 170], [60, 140, 70], [200, 170, 60], [140, 80, 160]];
        const col = cols[Math.floor(rnd() * cols.length)];
        for (let dx = 0; dx < w && x + dx < 15; dx++) for (let dy = 0; dy < 5; dy++) { const j = (dy === 0 || dy === 4) ? -30 : 0; px(T.BOOKSHELF, x + dx, row + dy, clamp(col[0] + j), clamp(col[1] + j), clamp(col[2] + j)); }
        x += w + (rnd() < 0.2 ? 1 : 0);
      }
    }
    // mossy
    copy(T.COBBLE, T.MOSSY); speck(T.MOSSY, [70, 120, 50], 16, 2);
    // white
    fill(T.WHITE, [255, 255, 255], 0);

    ctx.putImageData(img, 0, 0);
    return cv;
  }

  window.Blocks = { T, B, DEF, ATLAS_COLS, ATLAS_ROWS, TILE, buildAtlas };
})();
