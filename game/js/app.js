// GAME OF SEAMUS — rendering assembly, HUD, menus, input, save/load, main loop.
(function () {
  const { B, DEF, T } = Blocks;
  const { WX, WY, WZ, CS, SEA, CHX, CHZ } = WorldConst;
  const { M4, pushBox, pushLineBox } = GLR;
  const C = GameCore; const { G, $, clamp, lerp, smooth, msg, RECIPES, TOTAL_SHARDS, DAY_LENGTH, SAVE_KEY } = C;

  // ---------------- sky / time ----------------
  function skyState() {
    const t = G.time; const a = t * Math.PI * 2;
    const elev = Math.sin(a);
    const daylight = C.daylightAt(t);
    const sunDir = [Math.cos(a), Math.sin(a), Math.cos(a) * 0.35]; const l = Math.hypot(...sunDir); sunDir[0] /= l; sunDir[1] /= l; sunDir[2] /= l;
    const dayZ = [0.36, 0.62, 0.96], dayH = [0.72, 0.84, 0.96], nightZ = [0.01, 0.015, 0.05], nightH = [0.04, 0.05, 0.12];
    const dusk = Math.exp(-Math.pow(elev / 0.16, 2));
    const zen = [0, 0, 0], hor = [0, 0, 0];
    for (let i = 0; i < 3; i++) { zen[i] = lerp(nightZ[i], dayZ[i], daylight); hor[i] = lerp(nightH[i], dayH[i], daylight); }
    const duskCol = [0.98, 0.52, 0.28];
    for (let i = 0; i < 3; i++) hor[i] = lerp(hor[i], duskCol[i], dusk * 0.75);
    return { daylight, sunDir, zenith: zen, horizon: hor, elev };
  }

  // ---------------- dynamic geometry ----------------
  function buildEntities(daylight) {
    const verts = [], idx = [];
    for (const m of G.mobs) {
      const x = m.pos[0], y = m.pos[1], z = m.pos[2];
      const s = m.hurtT > 0 ? 0.85 : 1;
      const bobY = Math.abs(Math.sin(m.bob)) * 0.05;
      // rotate box around yaw: approximate by building axis-aligned and rotating vertices
      const startV = verts.length;
      pushBox(verts, idx, -0.3 * s, 0, -0.3 * s, 0.3 * s, 0.85 * s, 0.3 * s, { top: T.MOB_BODY, bottom: T.MOB_BODY, side: T.MOB_BODY }, 1, 0.25);
      pushBox(verts, idx, -0.33, 0.87, -0.33, 0.33, 1.45, 0.33, { top: T.MOB_BODY, bottom: T.MOB_BODY, px: T.MOB_BACK, nx: T.MOB_BACK, pz: T.MOB_BACK, nz: T.MOB_FACE }, 1, 0.25);
      // face glow: patch the face quad glow to 1
      const cy = Math.cos(m.yaw), sy = Math.sin(m.yaw);
      for (let i = startV; i < verts.length; i += 7) {
        const vx = verts[i], vz = verts[i + 2];
        verts[i] = x + vx * cy + vz * sy; verts[i + 1] += y + bobY; verts[i + 2] = z + (-vx * sy + vz * cy);
      }
      // head face (nz face is the 6th face of second box: index offset)
      const faceStart = startV + 6 * 4 * 7 + 5 * 4 * 7; for (let i = 0; i < 4; i++) verts[faceStart + i * 7 + 6] = 1.0;
    }
    return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
  }
  function buildHeld() {
    const P = G.player; const id = C.selectedBlock();
    const verts = [], idx = [];
    const swing = P.swing; const bob = P.bob;
    const sw = Math.sin(swing * Math.PI);
    let model;
    if (id) {
      const def = DEF[id];
      pushBox(verts, idx, 0, 0, 0, 1, 1, 1, { top: def.top, bottom: def.bottom, side: def.side }, 1, def.glow);
      model = M4.mul(M4.translate(0.66 + Math.sin(bob) * 0.02 - sw * 0.25, -0.62 + Math.abs(Math.cos(bob)) * 0.025 - sw * 0.2, -1.05 - sw * 0.1), M4.mul(M4.rotY(-0.5 + sw * 0.3), M4.mul(M4.rotX(0.12 - sw * 0.9), M4.scale(0.3, 0.3, 0.3))));
    } else {
      pushBox(verts, idx, -0.14, -0.14, -0.9, 0.14, 0.14, 0.1, { top: T.WHITE, bottom: T.WHITE, side: T.WHITE }, 1, 0);
      model = M4.mul(M4.translate(0.42 + Math.sin(bob) * 0.02 - sw * 0.25, -0.55 + Math.abs(Math.cos(bob)) * 0.025 - sw * 0.1, -0.15 - sw * 0.15), M4.mul(M4.rotY(-0.5 + sw * 0.5), M4.rotX(0.3 - sw * 0.9)));
    }
    return { verts: new Float32Array(verts), idx: new Uint32Array(idx), model, arm: !id };
  }
  function buildClouds() {
    const verts = [], idx = []; const n = new Noise.Simplex(4242); const cell = 8;
    for (let cz = -6; cz < WZ / cell + 6; cz++) for (let cx = -WX / cell; cx < 2 * WX / cell; cx++) {
      if (n.noise2D(cx * 0.13, cz * 0.13) + n.noise2D(cx * 0.4, cz * 0.4) * 0.3 < 0.28) continue;
      pushBox(verts, idx, cx * cell, 78, cz * cell, cx * cell + cell, 80.5, cz * cell + cell, { top: T.CLOUD, bottom: T.CLOUD, side: T.CLOUD }, 1, 0.12);
    }
    return { verts: new Float32Array(verts), idx: new Uint32Array(idx), offset: 0, dirty: true };
  }
  function buildOverlay() {
    const t = G.target; if (!t || G.breakP <= 0) return null;
    const verts = [], idx = []; const stage = Math.min(3, Math.floor(G.breakP * 4)); const e = 0.004;
    pushBox(verts, idx, t.x - e, t.y - e, t.z - e, t.x + 1 + e, t.y + 1 + e, t.z + 1 + e, { top: T.CRACK0 + stage, bottom: T.CRACK0 + stage, side: T.CRACK0 + stage }, 1, 1);
    return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
  }
  function buildLines() {
    const arr = [];
    if (G.target) { const t = G.target, e = 0.003; pushLineBox(arr, t.x - e, t.y - e, t.z - e, t.x + 1 + e, t.y + 1 + e, t.z + 1 + e, 0, 0, 0, 0.75); }
    if (G.targetMob) { const m = G.targetMob; pushLineBox(arr, m.pos[0] - m.w, m.pos[1], m.pos[2] - m.w, m.pos[0] + m.w, m.pos[1] + m.h, m.pos[2] + m.w, 1, 0.3, 0.3, 0.8); }
    return new Float32Array(arr);
  }
  function buildPoints() {
    const arr = [];
    for (const p of G.particles) arr.push(p.pos[0], p.pos[1], p.pos[2], p.col[0], p.col[1], p.col[2], Math.min(1, p.life * 2));
    return new Float32Array(arr);
  }
  let ocean = null;
  function buildOcean() {
    const verts = [], idx = []; const tu = 1 / Blocks.ATLAS_COLS, tv = 1 / Blocks.ATLAS_ROWS;
    const y = SEA + 1 - 0.12, E = 1200;
    const pts = [[-E, y, -E], [WX + E, y, -E], [WX + E, y, WX + E], [-E, y, WX + E]];
    for (let i = 0; i < 4; i++) verts.push(pts[i][0], pts[i][1], pts[i][2], pts[i][0], pts[i][2], 0.95, 0);
    idx.push(0, 2, 1, 0, 3, 2);
    return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
  }

  // ---------------- frame ----------------
  function render() {
    const P = G.player; const sky = skyState();
    const underwater = P.headInWater;
    const inCave = P.pos[1] < G.world.height[Math.floor(P.pos[2]) * WX + Math.floor(P.pos[0])] - 3;
    let fogColor = sky.horizon, fogNear = 90, fogFar = 175;
    if (underwater) { fogColor = [0.05, 0.2, 0.45]; fogNear = 1; fogFar = 22; }
    const torch = lerp(0.9, 0.35, sky.daylight);
    const camPos = C.eyePos();
    const state = {
      camPos, yaw: P.yaw, pitch: P.pitch, daylight: sky.daylight, sunDir: sky.sunDir, fogColor, fogNear, fogFar, zenith: sky.zenith, horizon: sky.horizon, time: G.playTime, underwater, torch,
      entities: buildEntities(sky.daylight), held: buildHeld(), clouds: G.clouds, overlay: buildOverlay(), lines: buildLines(), points: buildPoints(), ocean
    };
    G.clouds.offset = G.cloudOffset;
    G.R.render(state);
  }

  // ---------------- HUD ----------------
  const iconCache = new Map();
  function blockIcon(id, size) {
    const key = id + ':' + size; if (iconCache.has(key)) return iconCache.get(key);
    const def = DEF[id]; const cv = document.createElement('canvas'); cv.width = size; cv.height = size; const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const S = size, TL = Blocks.TILE, cols = Blocks.ATLAS_COLS;
    const src = (tile) => [(tile % cols) * TL, Math.floor(tile / cols) * TL];
    const draw = (tile, m, shade) => {
      const [sx, sy] = src(tile);
      ctx.save(); ctx.setTransform(m[0] * S / TL, m[1] * S / TL, m[2] * S / TL, m[3] * S / TL, m[4] * S, m[5] * S);
      ctx.drawImage(G.atlas, sx, sy, TL, TL, 0, 0, TL, TL);
      if (shade > 0) { ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(0, 0, TL, TL); }
      ctx.restore();
    };
    draw(def.side, [0.5, 0.25, 0, 0.5, 0, 0.25], 0.42);     // left
    draw(def.side, [0.5, -0.25, 0, 0.5, 0.5, 0.5], 0.22);   // right
    draw(def.top, [0.5, -0.25, 0.5, 0.25, 0, 0.25], 0);     // top
    iconCache.set(key, cv); return cv;
  }
  function renderHotbar() {
    const hb = $('hotbar'); hb.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const id = G.hotbar[i]; const slot = document.createElement('div'); slot.className = 'slot' + (i === G.sel ? ' sel' : '');
      if (id && G.inv.get(id)) { slot.appendChild(blockIcon(id, 40)); const c = document.createElement('span'); c.className = 'count'; c.textContent = G.inv.get(id); slot.appendChild(c); }
      slot.addEventListener('pointerdown', (e) => { e.preventDefault(); G.sel = i; renderHotbar(); });
      hb.appendChild(slot);
    }
    const id = G.hotbar[G.sel]; $('selname').textContent = id && G.inv.get(id) ? DEF[id].name : '';
  }
  function renderHearts() {
    const P = G.player; const el = $('hearts'); let s = '';
    const total = Math.ceil(P.maxHealth / 2);
    for (let i = 0; i < total; i++) { const hp = P.health - i * 2; s += `<span class="${hp >= 2 ? 'full' : hp === 1 ? 'half' : 'empty'}">♥</span>`; }
    el.innerHTML = s;
  }
  function updateHUD(dt) {
    const P = G.player;
    renderHearts();
    $('shards').textContent = `${G.shardsFound} / ${TOTAL_SHARDS}`;
    $('day').textContent = `Day ${G.day}`;
    const h = Math.floor(((G.time + 0.25) % 1) * 24), mnt = Math.floor((((G.time + 0.25) % 1) * 24 % 1) * 60);
    $('clock').textContent = `${String(h).padStart(2, '0')}:${String(mnt).padStart(2, '0')}`;
    // compass to nearest shard
    let best = null, bd = 1e9;
    for (const s of G.world.shards) { const k = s.join(','); if (G.collected.has(k)) continue; const d = Math.hypot(s[0] + 0.5 - P.pos[0], s[2] + 0.5 - P.pos[2]); if (d < bd) { bd = d; best = s; } }
    const comp = $('compass');
    if (best) {
      const dx = best[0] + 0.5 - P.pos[0], dz = best[2] + 0.5 - P.pos[2];
      const targetYaw = Math.atan2(-dx, -dz); let rel = targetYaw - P.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      $('needle').style.transform = `rotate(${-rel}rad)`;
      const dy = best[1] - P.pos[1];
      $('cdist').textContent = `${Math.round(bd)}m ${dy > 4 ? '↑' : dy < -4 ? '↓' : ''}`;
      comp.style.display = '';
    } else comp.style.display = 'none';
    $('vignette').style.opacity = P.health <= 6 ? (0.35 + 0.25 * Math.sin(G.playTime * 6)) : 0;
    $('water').style.opacity = P.headInWater ? 1 : 0;
    if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) $('msg').classList.remove('show'); }
    G.frames++; G.fpsT += dt; if (G.fpsT > 0.5) { G.fps = Math.round(G.frames / G.fpsT); G.frames = 0; G.fpsT = 0; $('fps').textContent = `${G.fps} fps · ${G.R.stats.chunksDrawn} chunks · ${(G.R.stats.tris / 1000).toFixed(0)}k tris`; }
    $('crosshair').classList.toggle('hot', !!G.targetMob);
  }

  // ---------------- inventory / crafting UI ----------------
  function renderInventory() {
    const grid = $('invgrid'); grid.innerHTML = '';
    const ids = [...G.inv.keys()].sort((a, b) => a - b);
    if (!ids.length) grid.innerHTML = '<div class="hint">Your pockets are empty. Go punch a tree.</div>';
    for (const id of ids) {
      const d = document.createElement('div'); d.className = 'islot' + (G.hotbar[G.sel] === id ? ' sel' : ''); d.title = DEF[id].name;
      d.appendChild(blockIcon(id, 44)); const c = document.createElement('span'); c.className = 'count'; c.textContent = G.inv.get(id); d.appendChild(c);
      const n = document.createElement('span'); n.className = 'iname'; n.textContent = DEF[id].name; d.appendChild(n);
      d.addEventListener('click', () => { const prev = G.hotbar.indexOf(id); if (prev >= 0) G.hotbar[prev] = G.hotbar[G.sel]; G.hotbar[G.sel] = id; renderHotbar(); renderInventory(); });
      grid.appendChild(d);
    }
    const rl = $('recipes'); rl.innerHTML = '';
    for (const r of RECIPES) {
      const done = (r.special === 'pick1' && G.pick >= 1) || (r.special === 'pick2' && G.pick >= 2) || (r.special === 'sword' && G.sword);
      const can = !done && r.needs.every(([id, n]) => C.invHas(id, n));
      const row = document.createElement('div'); row.className = 'recipe' + (can ? ' can' : '') + (done ? ' done' : '');
      const needs = r.needs.map(([id, n]) => `<span class="${C.invHas(id, n) ? 'ok' : 'no'}">${n} ${DEF[id].name}</span>`).join(' + ');
      row.innerHTML = `<div class="rname">${r.name}${done ? ' ✓' : ''}</div><div class="rdesc">${r.desc}</div><div class="rneeds">${needs}</div>`;
      const btn = document.createElement('button'); btn.textContent = done ? 'Owned' : 'Craft'; btn.disabled = !can;
      btn.addEventListener('click', () => craft(r)); row.appendChild(btn); rl.appendChild(row);
    }
    $('stats').textContent = `Pickaxe: ${['Hands', 'Stone', 'Iron'][G.pick]} · Blade: ${G.sword ? 'Iron' : 'None'} · Mined ${G.mined} · Placed ${G.placed} · Gloom slain ${G.kills}`;
  }
  function craft(r) {
    if (!r.needs.every(([id, n]) => C.invHas(id, n))) return;
    for (const [id, n] of r.needs) C.invTake(id, n);
    if (r.gives) for (const [id, n] of r.gives) C.invAdd(id, n);
    if (r.special === 'pick1') { G.pick = Math.max(G.pick, 1); msg('Stone Pickaxe crafted. Mining is faster!'); }
    if (r.special === 'pick2') { G.pick = 2; msg('Iron Pickaxe crafted. Mining is much faster!'); }
    if (r.special === 'sword') { G.sword = true; msg('Iron Blade forged. The Gloom should worry.'); }
    if (r.special === 'heart') { G.player.maxHealth = Math.min(30, G.player.maxHealth + 2); G.player.health = G.player.maxHealth; msg('You feel golden. Max health increased!'); }
    G.audio.craft(); renderHotbar(); renderInventory();
  }
  function toggleInventory(open) {
    G.invOpen = open === undefined ? !G.invOpen : open;
    $('inventory').classList.toggle('open', G.invOpen);
    if (G.invOpen) { renderInventory(); if (document.pointerLockElement) document.exitPointerLock(); G.mouseL = G.mouseR = false; }
    else if (!G.touch && G.started && !G.paused) lockPointer();
  }

  // ---------------- overlays / menus ----------------
  function showOverlay(kind) {
    G.paused = true; G.mouseL = G.mouseR = false; G.keys = {};
    if (document.pointerLockElement) document.exitPointerLock();
    for (const el of document.querySelectorAll('.overlay')) el.classList.remove('open');
    if (kind === 'win') { $('winstats').textContent = `Day ${G.day} · ${Math.floor(G.playTime / 60)}m ${Math.floor(G.playTime % 60)}s · ${G.mined} blocks mined · ${G.kills} Gloom slain · ${G.deaths} deaths`; $('win').classList.add('open'); }
    else if (kind === 'dead') $('dead').classList.add('open');
    else if (kind === 'pause') { $('pause').classList.add('open'); }
    else if (kind === 'title') $('title').classList.add('open');
    save();
  }
  window.showOverlay = showOverlay;
  function hideOverlays() { for (const el of document.querySelectorAll('.overlay')) el.classList.remove('open'); }
  function resume() {
    hideOverlays(); G.paused = false; G.started = true; G.audio.ensure();
    if (!G.touch) lockPointer();
  }
  function lockPointer() { const c = $('c'); if (c.requestPointerLock) { try { const p = c.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => c.requestPointerLock()); } catch (e) { try { c.requestPointerLock(); } catch (e2) { } } } }
  function respawn() {
    const P = G.player; P.dead = false; P.health = P.maxHealth; P.pos = [...G.world.spawn]; P.vel = [0, 0, 0]; P.maxY = P.pos[1];
    G.mobs = []; resume(); msg('You wake up at the shore of your camp.', 2400);
  }

  // ---------------- save / load ----------------
  function save() {
    if (!G.world || !G.started) return;
    try {
      const P = G.player;
      const data = { v: 1, seed: G.world.seed, edits: [...G.world.edits], pos: P.pos, yaw: P.yaw, pitch: P.pitch, health: P.health, maxHealth: P.maxHealth, inv: [...G.inv], hotbar: G.hotbar, sel: G.sel, time: G.time, day: G.day, shardsFound: G.shardsFound, collected: [...G.collected], pick: G.pick, sword: G.sword, kills: G.kills, mined: G.mined, placed: G.placed, deaths: G.deaths, playTime: G.playTime, won: G.won };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { }
  }
  function loadSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function applySave(d) {
    const P = G.player; G.world.applyEdits(d.edits);
    P.pos = d.pos; P.yaw = d.yaw; P.pitch = d.pitch; P.health = d.health; P.maxHealth = d.maxHealth || 20; P.maxY = P.pos[1];
    G.inv = new Map(d.inv); G.hotbar = d.hotbar; G.sel = d.sel || 0; G.time = d.time; G.day = d.day; G.shardsFound = d.shardsFound; G.collected = new Set(d.collected);
    G.pick = d.pick || 0; G.sword = !!d.sword; G.kills = d.kills || 0; G.mined = d.mined || 0; G.placed = d.placed || 0; G.deaths = d.deaths || 0; G.playTime = d.playTime || 0; G.won = !!d.won;
  }

  // ---------------- world setup ----------------
  function newWorld(seed, saveData, onDone) {
    G.world = new World(seed);
    const prog = $('progress'), bar = $('bar'); $('loading').classList.add('open'); hideOverlays(); $('loading').classList.add('open');
    const setP = (p, label) => { bar.style.width = (p * 100).toFixed(0) + '%'; prog.textContent = label; };
    setP(0, 'Shaping the land…');
    setTimeout(() => {
      G.world.generate((p) => setP(p, p < 0.3 ? 'Shaping the land…' : p < 0.7 ? 'Carving caves…' : 'Planting forests…'));
      if (saveData) applySave(saveData);
      else {
        const P = G.player; P.pos = [...G.world.spawn]; P.vel = [0, 0, 0]; P.yaw = Math.PI; P.pitch = -0.1; P.health = 20; P.maxHealth = 20; P.maxY = P.pos[1]; P.dead = false;
        G.inv = new Map(); G.hotbar = [0, 0, 0, 0, 0, 0, 0, 0, 0]; G.sel = 0; G.time = 0.22; G.day = 1; G.shardsFound = 0; G.collected = new Set(); G.pick = 0; G.sword = false; G.kills = 0; G.mined = 0; G.placed = 0; G.deaths = 0; G.playTime = 0; G.won = false;
        // face toward the island centre
        P.yaw = Math.atan2(-(WX / 2 - P.pos[0]), -(WZ / 2 - P.pos[2]));
      }
      G.mobs = []; G.particles = []; G.player.dead = false;
      // mesh chunks nearest-first in batches
      const order = [];
      for (let cz = 0; cz < CHZ; cz++) for (let cx = 0; cx < CHX; cx++) order.push([cx, cz]);
      const P = G.player; order.sort((a, b) => Math.hypot(a[0] * CS + 8 - P.pos[0], a[1] * CS + 8 - P.pos[2]) - Math.hypot(b[0] * CS + 8 - P.pos[0], b[1] * CS + 8 - P.pos[2]));
      let i = 0;
      const step = () => {
        const end = Math.min(order.length, i + 12);
        for (; i < end; i++) { const [cx, cz] = order[i]; G.R.uploadChunk(cx, cz, G.world.meshChunk(cx, cz)); }
        setP(0.75 + 0.25 * i / order.length, 'Building the world…');
        if (i < order.length) setTimeout(step, 0); else { G.world.dirty.clear(); $('loading').classList.remove('open'); onDone(); }
      };
      setTimeout(step, 0);
    }, 30);
  }
  function remeshDirty() {
    if (!G.world.dirty.size) return;
    const P = G.player; const keys = [...G.world.dirty];
    keys.sort((a, b) => { const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number); return Math.hypot(ax * CS + 8 - P.pos[0], az * CS + 8 - P.pos[2]) - Math.hypot(bx * CS + 8 - P.pos[0], bz * CS + 8 - P.pos[2]); });
    for (let i = 0; i < Math.min(3, keys.length); i++) { const [cx, cz] = keys[i].split(',').map(Number); G.R.uploadChunk(cx, cz, G.world.meshChunk(cx, cz)); G.world.dirty.delete(keys[i]); }
  }

  // ---------------- input ----------------
  function setupInput() {
    const c = $('c');
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.code === 'Escape') { if (G.invOpen) { toggleInventory(false); } return; }
      if (G.paused) return;
      G.keys[e.code] = true;
      if (e.code === 'KeyE') { toggleInventory(); e.preventDefault(); }
      if (e.code === 'KeyM') { G.muted = !G.muted; G.audio.setMuted(G.muted); msg(G.muted ? 'Sound off' : 'Sound on', 1000); }
      if (e.code === 'KeyF') { $('fps').classList.toggle('show'); }
      if (e.code.startsWith('Digit')) { const n = parseInt(e.code[5]); if (n >= 1 && n <= 9) { G.sel = n - 1; renderHotbar(); } }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => { G.keys[e.code] = false; });
    window.addEventListener('blur', () => { G.keys = {}; G.mouseL = G.mouseR = false; });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && G.started && !G.paused && !G.invOpen && !G.touch) showOverlay('pause');
    });
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement || G.paused) return;
      const P = G.player; P.yaw -= e.movementX * G.sens; P.pitch = clamp(P.pitch - e.movementY * G.sens, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    });
    c.addEventListener('mousedown', (e) => {
      if (G.paused || G.invOpen) return;
      if (!document.pointerLockElement && !G.touch) { lockPointer(); return; }
      if (e.button === 0) G.mouseL = true; if (e.button === 2) G.mouseR = true;
      if (e.button === 1) { const t = G.target; if (t) { const d = DEF[t.id].drop; if (C.invHas(d, 1)) { const i = G.hotbar.indexOf(d); if (i >= 0) G.sel = i; renderHotbar(); } } e.preventDefault(); }
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) G.mouseL = false; if (e.button === 2) G.mouseR = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { if (G.paused) return; G.sel = (G.sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9; renderHotbar(); e.preventDefault(); }, { passive: false });
    // menus
    $('btn-continue').addEventListener('click', () => start(true));
    $('btn-new').addEventListener('click', () => start(false));
    $('btn-resume').addEventListener('click', resume);
    $('btn-respawn').addEventListener('click', respawn);
    $('btn-keep').addEventListener('click', resume);
    $('btn-pause-new').addEventListener('click', () => { if (confirm('Start a brand new world? Your current world will be lost.')) { localStorage.removeItem(SAVE_KEY); start(false); } });
    $('btn-title').addEventListener('click', () => { save(); showOverlay('title'); refreshTitle(); });
    $('btn-inv-close').addEventListener('click', () => toggleInventory(false));
    $('sens').addEventListener('input', (e) => { G.sens = 0.0006 + parseFloat(e.target.value) * 0.004; });
    $('btn-mute').addEventListener('click', () => { G.muted = !G.muted; G.audio.setMuted(G.muted); $('btn-mute').textContent = G.muted ? '🔇 Sound off' : '🔊 Sound on'; });
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    setupTouch();
  }
  function setupTouch() {
    const isTouch = ('ontouchstart' in window) && matchMedia('(pointer: coarse)').matches;
    if (!isTouch) return;
    G.touch = { joy: [0, 0], jump: false, mine: false, place: false, sprint: false };
    document.body.classList.add('touch');
    const joy = $('joy'), knob = $('knob'); let jid = null, jc = null;
    const R = 46;
    joy.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; jid = t.identifier; const r = joy.getBoundingClientRect(); jc = [r.left + r.width / 2, r.top + r.height / 2]; e.preventDefault(); }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === jid) { let dx = t.clientX - jc[0], dy = t.clientY - jc[1]; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; G.touch.joy = [dx / R, dy / R]; G.touch.sprint = l > R * 0.95; }
      e.preventDefault();
    }, { passive: false });
    const endJoy = (e) => { for (const t of e.changedTouches) if (t.identifier === jid) { jid = null; knob.style.transform = ''; G.touch.joy = [0, 0]; G.touch.sprint = false; } };
    joy.addEventListener('touchend', endJoy); joy.addEventListener('touchcancel', endJoy);
    // look: drag anywhere on canvas
    const c = $('c'); const looks = new Map();
    c.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) looks.set(t.identifier, [t.clientX, t.clientY]); e.preventDefault(); }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) { const p = looks.get(t.identifier); if (!p) continue; const P = G.player; P.yaw -= (t.clientX - p[0]) * 0.005; P.pitch = clamp(P.pitch - (t.clientY - p[1]) * 0.005, -1.55, 1.55); looks.set(t.identifier, [t.clientX, t.clientY]); }
      e.preventDefault();
    }, { passive: false });
    const endLook = (e) => { for (const t of e.changedTouches) looks.delete(t.identifier); };
    c.addEventListener('touchend', endLook); c.addEventListener('touchcancel', endLook);
    const hold = (id, key) => { const el = $(id); el.addEventListener('touchstart', (e) => { G.touch[key] = true; e.preventDefault(); }, { passive: false }); const off = (e) => { G.touch[key] = false; e.preventDefault(); }; el.addEventListener('touchend', off); el.addEventListener('touchcancel', off); };
    hold('t-jump', 'jump'); hold('t-mine', 'mine');
    $('t-place').addEventListener('touchstart', (e) => { G.touch.place = true; e.preventDefault(); }, { passive: false });
    $('t-inv').addEventListener('touchstart', (e) => { toggleInventory(); e.preventDefault(); }, { passive: false });
  }

  // ---------------- main loop ----------------
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!G.world || !G.R) return;
    if (!G.paused && !G.invOpen) {
      G.playTime += dt;
      G.time += dt / DAY_LENGTH; if (G.time >= 1) { G.time -= 1; G.day++; msg(`Day ${G.day} dawns.`, 2000); }
      const dl = C.daylightAt(G.time);
      if (dl < 0.3 && G.lastDaylight >= 0.3) { msg('Night falls. The Gloom are stirring…', 3500); G.audio.night(); }
      if (dl > 0.6 && G.lastDaylight <= 0.6 && G.playTime > 5) { G.audio.dawn(); }
      G.lastDaylight = dl;
      C.updatePlayer(dt); C.updateInteraction(dt); C.spawnMobs(dt, dl); C.updateMobs(dt, dl); C.updateParticles(dt);
      G.cloudOffset = (G.cloudOffset + dt * 0.9) % WX;
      G.saveT += dt; if (G.saveT > 20) { G.saveT = 0; save(); }
      remeshDirty();
      updateHUD(dt);
      const sig = G.hotbar.join(',') + '|' + G.sel + '|' + [...G.inv.values()].join(',');
      if (sig !== G.hotbarSig) { G.hotbarSig = sig; renderHotbar(); }
    } else if (G.invOpen) { C.updatePlayer(dt * 0); }
    render();
  }

  function refreshTitle() {
    const s = loadSave();
    $('btn-continue').style.display = s ? '' : 'none';
    if (s) $('savedesc').textContent = `Day ${s.day} · ${s.shardsFound}/${TOTAL_SHARDS} shards · ${Math.floor((s.playTime || 0) / 60)} min played`;
    else $('savedesc').textContent = '';
  }
  function start(useSave) {
    const s = useSave ? loadSave() : null;
    const seed = s ? s.seed : (Math.random() * 4294967295) >>> 0;
    G.audio.ensure(); G.started = false; G.paused = true;
    newWorld(seed, s, () => {
      G.started = true; renderHotbar();
      $('seedlabel').textContent = 'Seed ' + seed;
      resume();
      if (!s) setTimeout(() => msg('Find the 12 Ember Shards. Follow the compass. Mind the night.', 4500), 400);
      else msg('Welcome back, Seamus.', 2000);
    });
  }

  function init() {
    G.atlas = Blocks.buildAtlas();
    // average tile colors for particles
    const ctx = G.atlas.getContext('2d'); const img = ctx.getImageData(0, 0, G.atlas.width, G.atlas.height).data;
    for (let t = 0; t < Blocks.ATLAS_COLS * Blocks.ATLAS_ROWS; t++) {
      let r = 0, g = 0, b = 0, n = 0; const tx = (t % Blocks.ATLAS_COLS) * 16, ty = Math.floor(t / Blocks.ATLAS_COLS) * 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = ((ty + y) * G.atlas.width + tx + x) * 4; if (img[i + 3] < 10) continue; r += img[i]; g += img[i + 1]; b += img[i + 2]; n++; }
      G.tileColors[t] = n ? [r / n / 255, g / n / 255, b / n / 255] : [0.5, 0.5, 0.5];
    }
    try { G.R = new GLR.Renderer($('c'), G.atlas); }
    catch (e) { $('nogl').style.display = 'block'; $('nogl').textContent = 'This browser cannot run the game (WebGL2 required). ' + e.message; return; }
    G.clouds = buildClouds(); ocean = buildOcean();
    setupInput(); refreshTitle(); $('title').classList.add('open');
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init); else init();
})();
