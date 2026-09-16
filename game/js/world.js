// Voxel world: generation, storage, edits, chunk meshing.
(function () {
  const { B, DEF, T, ATLAS_COLS, ATLAS_ROWS } = Blocks;
  const WX = 192, WY = 80, WZ = 192, CS = 16, SEA = 26;
  const CHX = WX / CS, CHZ = WZ / CS;

  class World {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.data = new Uint8Array(WX * WY * WZ);
      this.height = new Uint8Array(WX * WZ); // surface height (top solid)
      this.edits = new Map();
      this.shards = [];
      this.spawn = [WX / 2, 40, WZ / 2];
      this.dirty = new Set();
      this.n = new Noise.Simplex(this.seed);
      this.n2 = new Noise.Simplex(this.seed ^ 0x9e3779b9);
      this.n3 = new Noise.Simplex(this.seed ^ 0x51ed27f1);
      this.rand = Noise.mulberry32(this.seed ^ 0xabcdef);
    }
    idx(x, y, z) { return (y * WZ + z) * WX + x; }
    inBounds(x, y, z) { return x >= 0 && z >= 0 && y >= 0 && x < WX && z < WZ && y < WY; }
    get(x, y, z) {
      if (x < 0 || z < 0 || x >= WX || z >= WZ || y >= WY) return B.AIR;
      if (y < 0) return B.BEDROCK;
      return this.data[(y * WZ + z) * WX + x];
    }
    getDef(x, y, z) { return DEF[this.get(x, y, z)]; }
    isSolid(x, y, z) { return DEF[this.get(x, y, z)].solid; }
    setRaw(x, y, z, id) { if (this.inBounds(x, y, z)) this.data[(y * WZ + z) * WX + x] = id; }
    set(x, y, z, id, record) {
      if (!this.inBounds(x, y, z)) return false;
      const i = (y * WZ + z) * WX + x;
      if (this.data[i] === id) return false;
      this.data[i] = id;
      if (record !== false) this.edits.set(i, id);
      const cx = x >> 4, cz = z >> 4;
      this.dirty.add(cx + ',' + cz);
      if ((x & 15) === 0 && cx > 0) this.dirty.add((cx - 1) + ',' + cz);
      if ((x & 15) === 15 && cx < CHX - 1) this.dirty.add((cx + 1) + ',' + cz);
      if ((z & 15) === 0 && cz > 0) this.dirty.add(cx + ',' + (cz - 1));
      if ((z & 15) === 15 && cz < CHZ - 1) this.dirty.add(cx + ',' + (cz + 1));
      return true;
    }
    hash(x, y, z) { // deterministic per-position random in [0,1)
      let h = (x * 374761393 + y * 668265263 + z * 2147483647 + this.seed * 1013904223) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
    }
    surfaceY(x, z) { // top non-air, non-water
      for (let y = WY - 1; y >= 0; y--) { const b = this.get(x, y, z); if (b !== B.AIR && b !== B.WATER) return y; }
      return 0;
    }

    // ---------- generation ----------
    generate(progress) {
      const n = this.n, n2 = this.n2, n3 = this.n3;
      const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
      const heights = new Float32Array(WX * WZ);
      const cx0 = WX / 2, cz0 = WZ / 2;
      for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) {
        const cont = n.fbm2(x / 150, z / 150, 4, 2.1, 0.5);
        const detail = n2.fbm2(x / 38, z / 38, 4, 2.0, 0.5);
        const mtnMask = smooth(0.05, 0.55, n3.noise2D(x / 110 + 30, z / 110));
        const ridge = 1 - Math.abs(n2.noise2D(x / 48 + 200, z / 48 + 200));
        let h = SEA + 2 + cont * 12 + detail * 5 + ridge * ridge * 34 * mtnMask;
        const d = Math.max(Math.abs(x - cx0), Math.abs(z - cz0)) / (WX / 2);
        h -= smooth(0.72, 1.0, d) * 34; // island falloff
        heights[z * WX + x] = h;
      }
      const data = this.data;
      for (let z = 0; z < WZ; z++) {
        for (let x = 0; x < WX; x++) {
          const h = Math.max(2, Math.min(WY - 6, Math.round(heights[z * WX + x])));
          const beach = h <= SEA + 1;
          const alpine = h > 56, peak = h > 63;
          for (let y = 0; y <= h; y++) {
            let id;
            if (y === 0) id = B.BEDROCK;
            else if (y < h - 3) id = B.STONE;
            else if (y < h) id = beach ? B.SAND : (peak ? B.STONE : B.DIRT);
            else id = beach ? B.SAND : (peak ? B.SNOW : (alpine ? B.SNOW : B.GRASS));
            if (id === B.STONE) {
              const r = this.hash(x, y, z);
              if (y < 44 && r < 0.012) id = B.COAL_ORE;
              else if (y < 34 && r > 0.994) id = B.IRON_ORE;
              else if (y < 20 && r > 0.985 && r < 0.988) id = B.GOLD_ORE;
              else if (r > 0.5 && r < 0.503 && y < h - 6) id = B.GRAVEL;
            }
            data[(y * WZ + z) * WX + x] = id;
          }
          for (let y = h + 1; y <= SEA; y++) data[(y * WZ + z) * WX + x] = B.WATER;
          this.height[z * WX + x] = h;
        }
        if (progress && (z & 31) === 31) progress(0.3 * z / WZ);
      }
      // caves
      for (let z = 1; z < WZ - 1; z++) {
        for (let x = 1; x < WX - 1; x++) {
          const h = this.height[z * WX + x];
          if (h <= SEA + 1) continue;
          for (let y = 3; y < h - 2; y++) {
            const a = n3.noise3D(x / 22, y / 14, z / 22);
            const b = n2.noise3D(x / 22 + 100, y / 14, z / 22 + 100);
            const worm = Math.abs(a) < 0.075 && Math.abs(b) < 0.075;
            const cavern = n.noise3D(x / 30, y / 18, z / 30) > 0.68;
            if (worm || cavern) {
              const i = (y * WZ + z) * WX + x;
              if (data[i] !== B.BEDROCK) data[i] = B.AIR;
            }
          }
        }
        if (progress && (z & 31) === 31) progress(0.3 + 0.4 * z / WZ);
      }
      // trees
      for (let z = 3; z < WZ - 3; z++) for (let x = 3; x < WX - 3; x++) {
        const h = this.height[z * WX + x];
        if (this.get(x, h, z) !== B.GRASS) continue;
        const forest = n.noise2D(x / 60 + 500, z / 60 + 500);
        const p = 0.004 + Math.max(0, forest) * 0.03;
        if (this.hash(x, 1000, z) > p) continue;
        this.placeTree(x, h + 1, z);
      }
      // spawn point
      this.spawn = this.findSpawn();
      // shards
      this.placeShards();
      if (progress) progress(0.75);
    }
    placeTree(x, y, z) {
      const th = 4 + Math.floor(this.hash(x, 2000, z) * 3);
      for (let i = 0; i < th; i++) this.setRaw(x, y + i, z, B.LOG);
      const top = y + th - 1;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy <= 0 ? 2 : 1;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy > 0 || this.hash(x + dx, top + dy, z + dz) < 0.5)) continue;
          if (dx === 0 && dz === 0 && dy <= 0) continue;
          if (this.get(x + dx, top + dy, z + dz) === B.AIR) this.setRaw(x + dx, top + dy, z + dz, B.LEAVES);
        }
      }
      this.setRaw(x, top + 1, z, B.LEAVES);
      this.setRaw(x, top + 2, z, B.LEAVES);
    }
    findSpawn() {
      let best = null, bestD = 1e9;
      for (let z = 20; z < WZ - 20; z += 3) for (let x = 20; x < WX - 20; x += 3) {
        const h = this.height[z * WX + x];
        if (this.get(x, h, z) !== B.GRASS) continue;
        if (this.get(x, h + 1, z) !== B.AIR || this.get(x, h + 2, z) !== B.AIR) continue;
        const d = Math.hypot(x - WX / 2, z - WZ / 2);
        if (d < bestD) { bestD = d; best = [x + 0.5, h + 1, z + 0.5]; }
      }
      return best || [WX / 2, SEA + 10, WZ / 2];
    }
    placeShards() {
      const shards = [];
      const sp = this.spawn;
      const rand = this.rand;
      const farEnough = (x, z, min) => {
        if (Math.hypot(x - sp[0], z - sp[2]) < 24) return false;
        for (const s of shards) if (Math.hypot(x - s[0], z - s[2]) < min) return false;
        return true;
      };
      // surface shards
      let tries = 0;
      while (shards.length < 5 && tries++ < 4000) {
        const x = 8 + Math.floor(rand() * (WX - 16)), z = 8 + Math.floor(rand() * (WZ - 16));
        const h = this.surfaceY(x, z);
        if (h <= SEA) continue;
        const b = this.get(x, h, z);
        if (b !== B.GRASS && b !== B.SAND && b !== B.SNOW && b !== B.STONE) continue;
        if (!farEnough(x, z, 30)) continue;
        shards.push([x, h + 1, z]);
      }
      // mountain shards: highest points
      const peaks = [];
      for (let z = 8; z < WZ - 8; z += 2) for (let x = 8; x < WX - 8; x += 2) {
        const h = this.height[z * WX + x]; if (h > 50) peaks.push([x, h, z]);
      }
      peaks.sort((a, b) => b[1] - a[1]);
      for (const p of peaks) {
        if (shards.length >= 8) break;
        const y = this.surfaceY(p[0], p[2]);
        if (this.get(p[0], y + 1, p[2]) !== B.AIR) continue;
        if (!farEnough(p[0], p[2], 30)) continue;
        shards.push([p[0], y + 1, p[2]]);
      }
      // cave shards: air pocket with solid floor below surface
      tries = 0;
      while (shards.length < 12 && tries++ < 20000) {
        const x = 8 + Math.floor(rand() * (WX - 16)), z = 8 + Math.floor(rand() * (WZ - 16));
        const h = this.height[z * WX + x];
        if (h <= SEA + 2) continue;
        const y = 6 + Math.floor(rand() * Math.max(1, h - 14));
        if (this.get(x, y, z) !== B.AIR || this.get(x, y + 1, z) !== B.AIR) continue;
        if (!DEF[this.get(x, y - 1, z)].solid || this.get(x, y - 1, z) === B.WATER) continue;
        // must be enclosed: some solid above
        let covered = false; for (let yy = y + 2; yy < h + 2; yy++) if (DEF[this.get(x, yy, z)].solid) { covered = true; break; }
        if (!covered) continue;
        if (!farEnough(x, z, 20)) continue;
        shards.push([x, y, z]);
      }
      // fallback: more surface shards
      tries = 0;
      while (shards.length < 12 && tries++ < 20000) {
        const x = 8 + Math.floor(rand() * (WX - 16)), z = 8 + Math.floor(rand() * (WZ - 16));
        const h = this.surfaceY(x, z);
        if (h <= SEA || !farEnough(x, z, 20)) continue;
        if (this.get(x, h + 1, z) !== B.AIR) continue;
        shards.push([x, h + 1, z]);
      }
      for (const s of shards) this.setRaw(s[0], s[1], s[2], B.SHARD);
      this.shards = shards;
    }
    applyEdits(edits) {
      for (const [i, id] of edits) { this.data[i] = id; this.edits.set(i, id); }
    }
    countBlocks(id) { let c = 0; const d = this.data; for (let i = 0; i < d.length; i++) if (d[i] === id) c++; return c; }

    // ---------- meshing ----------
    // vertex: x y z u v light glow  (7 floats)
    meshChunk(cx, cz) {
      const op = [], opi = [], tr = [], tri = [];
      const x0 = cx * CS, z0 = cz * CS;
      const tu = 1 / ATLAS_COLS, tv = 1 / ATLAS_ROWS;
      const get = (x, y, z) => this.get(x, y, z);
      const data = this.data;
      // face definitions: normal, 4 corners (ccw from outside), shade
      // corner order arranged so that AO diagonal flips can be decided
      const FACES = [
        { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0, side: 'top' },
        { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.5, side: 'bottom' },
        { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.6, side: 'side' },
        { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.6, side: 'side' },
        { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.8, side: 'side' },
        { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.8, side: 'side' },
      ];
      const UVS = [[0, 1], [1, 1], [1, 0], [0, 0]];
      const solidForAO = (x, y, z) => { const d = DEF[get(x, y, z)]; return d.solid && !d.transparent; };
      for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
        const x = x0 + lx, z = z0 + lz;
        for (let y = 0; y < WY; y++) {
          const id = data[(y * WZ + z) * WX + x];
          if (id === B.AIR) continue;
          const def = DEF[id];
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
            const nid = get(nx, ny, nz);
            const ndef = DEF[nid];
            let visible;
            if (def.liquid) visible = nid === B.AIR || (!ndef.liquid && ndef.transparent && nid !== B.SHARD) ;
            else if (def.transparent) visible = nid !== id && (nid === B.AIR || ndef.transparent);
            else visible = nid === B.AIR || ndef.transparent;
            if (!visible) continue;
            const tile = F.side === 'top' ? def.top : F.side === 'bottom' ? def.bottom : def.side;
            const u0 = (tile % ATLAS_COLS) * tu, v0 = Math.floor(tile / ATLAS_COLS) * tv;
            const target = (def.liquid || id === B.GLASS) ? tr : op;
            const tidx = (def.liquid || id === B.GLASS) ? tri : opi;
            const base = target.length / 7;
            const ao = [0, 0, 0, 0];
            for (let c = 0; c < 4; c++) {
              const v = F.v[c];
              let vx = x + v[0], vy = y + v[1], vz = z + v[2];
              if (def.liquid && v[1] === 1 && get(x, y + 1, z) !== B.WATER) vy -= 0.12;
              // AO: for corner, sample the two edge-adjacent and one corner block on the face's outer side
              let a = 0;
              if (!def.liquid && !def.glow) {
                const dx = v[0] === 0 ? -1 : 1, dy = v[1] === 0 ? -1 : 1, dz = v[2] === 0 ? -1 : 1;
                let s1, s2, cn;
                if (F.n[1] !== 0) { s1 = solidForAO(x + dx, ny, z); s2 = solidForAO(x, ny, z + dz); cn = solidForAO(x + dx, ny, z + dz); }
                else if (F.n[0] !== 0) { s1 = solidForAO(nx, y + dy, z); s2 = solidForAO(nx, y, z + dz); cn = solidForAO(nx, y + dy, z + dz); }
                else { s1 = solidForAO(x + dx, y, nz); s2 = solidForAO(x, y + dy, nz); cn = solidForAO(x + dx, y + dy, nz); }
                a = (s1 && s2) ? 3 : (s1 + s2 + cn);
              }
              ao[c] = a;
              const light = F.s * (1 - a * 0.18);
              target.push(vx, vy, vz, u0 + UVS[c][0] * tu, v0 + UVS[c][1] * tv, light, def.glow);
            }
            // flip quad diagonal for smoother AO
            if (ao[0] + ao[2] > ao[1] + ao[3]) tidx.push(base + 1, base + 2, base + 3, base + 3, base + 0, base + 1);
            else tidx.push(base, base + 1, base + 2, base + 2, base + 3, base);
          }
        }
      }
      return {
        opaque: new Float32Array(op), opaqueIdx: new Uint32Array(opi),
        trans: new Float32Array(tr), transIdx: new Uint32Array(tri)
      };
    }
  }

  window.World = World;
  window.WorldConst = { WX, WY, WZ, CS, SEA, CHX, CHZ };
})();
