// GAME OF SEAMUS — main game logic.
(function () {
  const { B, DEF, T } = Blocks;
  const { WX, WY, WZ, CS, SEA, CHX, CHZ } = WorldConst;
  const { M4, pushBox, pushLineBox } = GLR;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const DAY_LENGTH = 480; // seconds per full day
  const SAVE_KEY = 'gameofseamus.save.v1';
  const TOTAL_SHARDS = 12;
  const SOUND_KIND = { [B.STONE]: 'stone', [B.COBBLE]: 'stone', [B.BEDROCK]: 'stone', [B.COAL_ORE]: 'stone', [B.IRON_ORE]: 'stone', [B.GOLD_ORE]: 'stone', [B.BRICK]: 'stone', [B.MOSSY]: 'stone', [B.LOG]: 'wood', [B.PLANKS]: 'wood', [B.BOOKSHELF]: 'wood', [B.SAND]: 'sand', [B.GRAVEL]: 'sand', [B.LEAVES]: 'leaves', [B.GLASS]: 'stone' };

  const RECIPES = [
    { id: 'planks', name: 'Oak Planks ×4', desc: 'Building basics.', needs: [[B.LOG, 1]], gives: [[B.PLANKS, 4]] },
    { id: 'glass', name: 'Glass ×4', desc: 'Sand fired with coal.', needs: [[B.SAND, 2], [B.COAL_ORE, 1]], gives: [[B.GLASS, 4]] },
    { id: 'brick', name: 'Brick ×4', desc: 'Cobblestone fired with coal.', needs: [[B.COBBLE, 4], [B.COAL_ORE, 1]], gives: [[B.BRICK, 4]] },
    { id: 'lantern', name: 'Lantern ×2', desc: 'Glows. Keeps night at bay (a little).', needs: [[B.IRON_ORE, 1], [B.COAL_ORE, 1]], gives: [[B.LANTERN, 2]] },
    { id: 'mossy', name: 'Mossy Stone ×2', desc: 'For ruins and gardens.', needs: [[B.COBBLE, 2], [B.LEAVES, 1]], gives: [[B.MOSSY, 2]] },
    { id: 'bookshelf', name: 'Bookshelf ×1', desc: 'Decorative. Very smart-looking.', needs: [[B.PLANKS, 4], [B.LEAVES, 2]], gives: [[B.BOOKSHELF, 1]] },
    { id: 'pick1', name: 'Stone Pickaxe', desc: 'Mine 1.7× faster.', needs: [[B.COBBLE, 3], [B.LOG, 1]], special: 'pick1' },
    { id: 'pick2', name: 'Iron Pickaxe', desc: 'Mine 2.8× faster.', needs: [[B.IRON_ORE, 3], [B.LOG, 1]], special: 'pick2' },
    { id: 'sword', name: 'Iron Blade', desc: 'Double damage against Gloom.', needs: [[B.IRON_ORE, 2], [B.LOG, 1]], special: 'sword' },
    { id: 'heart', name: 'Gilded Heart', desc: 'Full heal, +1 max heart (up to 15).', needs: [[B.GOLD_ORE, 2]], special: 'heart' },
  ];

  // ---------------- game state ----------------
  const G = {
    world: null, R: null, audio: new GameAudio(), atlas: null, tileColors: [],
    player: { pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, w: 0.3, h: 1.8, eye: 1.62, onGround: false, inWater: false, headInWater: false, health: 20, maxHealth: 20, lastHurt: 99, maxY: 0, sprint: false, sneak: false, bob: 0, swing: 0, stepT: 0, dead: false },
    inv: new Map(), hotbar: [B.DIRT, 0, 0, 0, 0, 0, 0, 0, 0], sel: 0,
    time: 0.22, day: 1, shardsFound: 0, collected: new Set(), pick: 0, sword: false, kills: 0, mined: 0, placed: 0, deaths: 0, playTime: 0,
    mobs: [], particles: [], target: null, targetMob: null, breakP: 0, breakKey: '', placeT: 0, attackT: 0,
    keys: {}, mouseL: false, mouseR: false, paused: true, started: false, won: false, muted: false, sens: 0.0022, running: false,
    spawnT: 0, msgT: 0, dirtyQueue: [], lastNight: false, clouds: null, cloudOffset: 0, saveT: 0, fps: 0, frames: 0, fpsT: 0, invOpen: false, touch: null, wasHeadInWater: false,
    lastDaylight: 1
  };
  window.G = G;

  // ---------------- helpers ----------------
  function invAdd(id, n) { G.inv.set(id, (G.inv.get(id) || 0) + n); if (!G.hotbar.includes(id)) { const i = G.hotbar.indexOf(0); if (i >= 0) G.hotbar[i] = id; } }
  function invHas(id, n) { return (G.inv.get(id) || 0) >= n; }
  function invTake(id, n) { const c = (G.inv.get(id) || 0) - n; if (c <= 0) { G.inv.delete(id); const i = G.hotbar.indexOf(id); if (i >= 0) G.hotbar[i] = 0; } else G.inv.set(id, c); }
  function selectedBlock() { const id = G.hotbar[G.sel]; return id && invHas(id, 1) ? id : 0; }
  function msg(text, ms) { const el = $('msg'); el.textContent = text; el.classList.add('show'); G.msgT = (ms || 2600) / 1000; }
  function daylightAt(t) { const elev = Math.sin(t * Math.PI * 2); return smooth(-0.14, 0.22, elev); }

  // ---------------- physics ----------------
  function aabbCollides(minx, miny, minz, maxx, maxy, maxz) {
    const x0 = Math.floor(minx), x1 = Math.floor(maxx - 1e-6), y0 = Math.floor(miny), y1 = Math.floor(maxy - 1e-6), z0 = Math.floor(minz), z1 = Math.floor(maxz - 1e-6);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (DEF[G.world.get(x, y, z)].solid) return true;
    return false;
  }
  function moveEntity(e, dt) {
    // returns whether horizontal movement was blocked
    const w = e.w, h = e.h; let blocked = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vel[0]), Math.abs(e.vel[1]), Math.abs(e.vel[2])) * dt / 0.4));
    const sdt = dt / steps;
    e.onGround = false;
    for (let s = 0; s < steps; s++) {
      for (let axis = 0; axis < 3; axis++) {
        const d = e.vel[axis] * sdt; if (d === 0) continue;
        const p = e.pos; p[axis] += d;
        const minx = p[0] - w, maxx = p[0] + w, miny = p[1], maxy = p[1] + h, minz = p[2] - w, maxz = p[2] + w;
        if (aabbCollides(minx, miny, minz, maxx, maxy, maxz)) {
          if (axis === 1) {
            if (d < 0) { p[1] = Math.floor(miny) + 1 + 1e-4; e.onGround = true; } else p[1] = Math.floor(maxy) - h - 1e-4;
          } else {
            const half = w;
            if (d > 0) p[axis] = Math.floor(p[axis] + half) - half - 1e-4; else p[axis] = Math.floor(p[axis] - half) + 1 + half + 1e-4;
            blocked = true;
          }
          if (axis === 1) e.vel[axis] = 0;
        }
      }
    }
    // world bounds
    e.pos[0] = clamp(e.pos[0], 1, WX - 1); e.pos[2] = clamp(e.pos[2], 1, WZ - 1);
    if (e.pos[1] < -10) { e.pos[1] = 1; e.vel[1] = 0; }
    return blocked;
  }
  function blockAt(p, dy) { return G.world.get(Math.floor(p[0]), Math.floor(p[1] + (dy || 0)), Math.floor(p[2])); }

  function updatePlayer(dt) {
    const P = G.player, k = G.keys;
    if (P.dead) return;
    const feet = blockAt(P.pos, 0.2), mid = blockAt(P.pos, 0.9), head = blockAt(P.pos, P.eye);
    P.inWater = feet === B.WATER || mid === B.WATER;
    P.headInWater = head === B.WATER;
    if (P.headInWater && !G.wasHeadInWater) G.audio.splash();
    G.wasHeadInWater = P.headInWater;
    let fx = 0, fz = 0;
    const tj = G.touch ? G.touch.joy : null;
    if (k.KeyW || k.ArrowUp) fz -= 1; if (k.KeyS || k.ArrowDown) fz += 1; if (k.KeyA || k.ArrowLeft) fx -= 1; if (k.KeyD || k.ArrowRight) fx += 1;
    if (tj) { fx += tj[0]; fz += tj[1]; }
    const len = Math.hypot(fx, fz); if (len > 1) { fx /= len; fz /= len; }
    P.sprint = !!(k.ShiftLeft || k.ShiftRight || (G.touch && G.touch.sprint)) && fz < 0;
    P.sneak = !!(k.ControlLeft || k.KeyC && false);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    // world dir: forward = (-sy, -cy), right = (cy, -sy)
    let dx = (-sy) * (-fz) + cy * fx, dz = (-cy) * (-fz) + (-sy) * fx;
    let speed = P.sprint ? 5.8 : 4.3; if (P.inWater) speed = 2.6;
    const accel = P.onGround ? 14 : (P.inWater ? 5 : 2.6);
    const f = 1 - Math.exp(-accel * dt);
    P.vel[0] = lerp(P.vel[0], dx * speed, f); P.vel[2] = lerp(P.vel[2], dz * speed, f);
    const jump = k.Space || (G.touch && G.touch.jump);
    if (P.inWater) {
      P.vel[1] -= 9 * dt; P.vel[1] = Math.max(P.vel[1], -2.5);
      if (jump) P.vel[1] = Math.min(P.vel[1] + 30 * dt, 3.6);
      P.maxY = P.pos[1];
    } else {
      P.vel[1] -= 32 * dt; P.vel[1] = Math.max(P.vel[1], -70);
      if (jump && P.onGround) { P.vel[1] = 9.3; P.onGround = false; G.audio.jump(); }
    }
    if (P.pos[1] > P.maxY) P.maxY = P.pos[1];
    const wasGround = P.onGround;
    moveEntity(P, dt);
    if (P.onGround && !wasGround) {
      const fall = P.maxY - P.pos[1];
      if (fall > 3.4 && !P.inWater) hurt(Math.floor(fall - 2.4), null);
      else if (fall > 1.0) G.audio.step(SOUND_KIND[blockAt(P.pos, -0.1)] || 'dirt');
      P.maxY = P.pos[1];
    }
    if (P.onGround) P.maxY = P.pos[1];
    // walking bob + footsteps
    const hs = Math.hypot(P.vel[0], P.vel[2]);
    if (P.onGround && hs > 0.5) {
      P.bob += dt * hs * 1.9; P.stepT += dt * hs;
      if (P.stepT > 2.2) { P.stepT = 0; G.audio.step(SOUND_KIND[blockAt(P.pos, -0.1)] || 'dirt'); }
    }
    if (P.swing > 0) P.swing = Math.max(0, P.swing - dt * 5);
    P.lastHurt += dt;
    if (P.lastHurt > 6 && P.health < P.maxHealth) { P.regenT = (P.regenT || 0) + dt; if (P.regenT > 2.5) { P.regenT = 0; P.health = Math.min(P.maxHealth, P.health + 1); } }
    if (G.attackT > 0) G.attackT -= dt; if (G.placeT > 0) G.placeT -= dt;
  }
  function hurt(n, from) {
    const P = G.player; if (P.dead || n <= 0) return;
    P.health -= n; P.lastHurt = 0; G.audio.hurt();
    const v = $('vignette'); v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash');
    if (from) { const dx = P.pos[0] - from[0], dz = P.pos[2] - from[2]; const l = Math.hypot(dx, dz) || 1; P.vel[0] += dx / l * 7; P.vel[2] += dz / l * 7; P.vel[1] = 5; }
    if (P.health <= 0) { P.health = 0; P.dead = true; G.deaths++; showOverlay('dead'); }
  }

  // ---------------- raycast ----------------
  function eyePos() { const P = G.player; return [P.pos[0], P.pos[1] + P.eye - (P.sneak ? 0.2 : 0), P.pos[2]]; }
  function lookDir() { const P = G.player; const cp = Math.cos(P.pitch); return [-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp]; }
  function raycast(maxD) {
    const o = eyePos(), d = lookDir();
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (d[0] || 1e-9)), tdy = Math.abs(1 / (d[1] || 1e-9)), tdz = Math.abs(1 / (d[2] || 1e-9));
    let tmx = (d[0] > 0 ? (x + 1 - o[0]) : (o[0] - x)) * tdx, tmy = (d[1] > 0 ? (y + 1 - o[1]) : (o[1] - y)) * tdy, tmz = (d[2] > 0 ? (z + 1 - o[2]) : (o[2] - z)) * tdz;
    let face = [0, 0, 0], t = 0;
    for (let i = 0; i < 64; i++) {
      const id = G.world.get(x, y, z);
      if (id !== B.AIR && id !== B.WATER) return { x, y, z, id, face, dist: t };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; face = [-sx, 0, 0]; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; face = [0, -sy, 0]; }
      else { z += sz; t = tmz; tmz += tdz; face = [0, 0, -sz]; }
      if (t > maxD) break;
    }
    return null;
  }
  function rayAABB(o, d, min, max) {
    let tmin = 0, tmax = 1e9;
    for (let i = 0; i < 3; i++) {
      const inv = 1 / (d[i] || 1e-9); let t0 = (min[i] - o[i]) * inv, t1 = (max[i] - o[i]) * inv;
      if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
      tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); if (tmin > tmax) return -1;
    }
    return tmin;
  }
  function updateTarget() {
    const reach = 5.2;
    G.target = raycast(reach);
    G.targetMob = null;
    const o = eyePos(), d = lookDir();
    let best = G.target ? G.target.dist : reach;
    for (const m of G.mobs) {
      const t = rayAABB(o, d, [m.pos[0] - m.w, m.pos[1], m.pos[2] - m.w], [m.pos[0] + m.w, m.pos[1] + m.h, m.pos[2] + m.w]);
      if (t >= 0 && t < best) { best = t; G.targetMob = m; }
    }
    if (G.targetMob) G.target = null;
  }

  // ---------------- interaction ----------------
  function pickSpeed() { return G.pick === 2 ? 2.8 : G.pick === 1 ? 1.7 : 1; }
  function spawnParticles(x, y, z, id, n) {
    const col = G.tileColors[DEF[id].side] || [0.5, 0.5, 0.5];
    for (let i = 0; i < n; i++) G.particles.push({ pos: [x + Math.random(), y + Math.random(), z + Math.random()], vel: [(Math.random() - 0.5) * 4, Math.random() * 5 + 1, (Math.random() - 0.5) * 4], life: 0.6 + Math.random() * 0.6, col: [col[0] * (0.8 + Math.random() * 0.4), col[1] * (0.8 + Math.random() * 0.4), col[2] * (0.8 + Math.random() * 0.4)] });
  }
  function breakBlock(x, y, z) {
    const id = G.world.get(x, y, z); const def = DEF[id]; if (id === B.AIR || def.hardness === Infinity) return;
    G.world.set(x, y, z, B.AIR);
    spawnParticles(x, y, z, id, 14);
    G.mined++;
    if (id === B.SHARD) {
      G.audio.pickup(); G.shardsFound++; G.collected.add(x + ',' + y + ',' + z);
      const left = TOTAL_SHARDS - G.shardsFound;
      msg(left > 0 ? `Ember Shard found! ${left} remaining.` : 'All Ember Shards gathered!', 3200);
      if (left <= 0 && !G.won) { G.won = true; G.audio.win(); setTimeout(() => showOverlay('win'), 900); }
      return;
    }
    G.audio.breakBlock(SOUND_KIND[id] || 'dirt');
    if (def.drop) invAdd(def.drop, 1);
    // gravity for sand/gravel above
    let yy = y + 1; while (true) { const above = G.world.get(x, yy, z); if (above === B.SAND || above === B.GRAVEL) { G.world.set(x, yy - 1, z, above); G.world.set(x, yy, z, B.AIR); yy++; } else break; }
  }
  function placeBlock() {
    const t = G.target; if (!t) return false;
    const id = selectedBlock(); if (!id) { msg('Nothing to place. Mine some blocks first!', 1600); return false; }
    const x = t.x + t.face[0], y = t.y + t.face[1], z = t.z + t.face[2];
    if (!G.world.inBounds(x, y, z)) return false;
    const cur = G.world.get(x, y, z); if (cur !== B.AIR && cur !== B.WATER) return false;
    const P = G.player;
    const overlaps = (e) => x < e.pos[0] + e.w && x + 1 > e.pos[0] - e.w && y < e.pos[1] + e.h && y + 1 > e.pos[1] && z < e.pos[2] + e.w && z + 1 > e.pos[2] - e.w;
    if (overlaps(P)) return false; for (const m of G.mobs) if (overlaps(m)) return false;
    G.world.set(x, y, z, id); invTake(id, 1); G.placed++; G.audio.place(); P.swing = 1;
    return true;
  }
  function attackMob(m) {
    const dmg = G.sword ? 8 : 4; m.hp -= dmg; m.hurtT = 0.3; G.audio.hit();
    const P = G.player; const dx = m.pos[0] - P.pos[0], dz = m.pos[2] - P.pos[2]; const l = Math.hypot(dx, dz) || 1;
    m.vel[0] += dx / l * 7; m.vel[2] += dz / l * 7; m.vel[1] = 4.5;
    spawnParticles(m.pos[0] - 0.5, m.pos[1] + 0.3, m.pos[2] - 0.5, B.COAL_ORE, 6);
    if (m.hp <= 0) killMob(m, true);
  }
  function killMob(m, byPlayer) {
    const i = G.mobs.indexOf(m); if (i >= 0) G.mobs.splice(i, 1);
    for (let k = 0; k < 18; k++) G.particles.push({ pos: [m.pos[0] + (Math.random() - 0.5) * 0.6, m.pos[1] + Math.random() * 1.2, m.pos[2] + (Math.random() - 0.5) * 0.6], vel: [(Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3], life: 0.8, col: byPlayer ? [0.5, 0.2, 0.7] : [1, 0.5, 0.1] });
    if (byPlayer) { G.kills++; if (Math.random() < 0.35) { invAdd(B.COAL_ORE, 1); msg('The Gloom dropped a lump of coal.', 1800); } }
  }
  function updateInteraction(dt) {
    const P = G.player; if (P.dead || G.paused) return;
    updateTarget();
    const mining = G.mouseL || (G.touch && G.touch.mine);
    if (mining && G.targetMob && G.attackT <= 0) { attackMob(G.targetMob); G.attackT = 0.45; P.swing = 1; }
    if (mining && G.target) {
      const t = G.target, key = t.x + ',' + t.y + ',' + t.z;
      if (key !== G.breakKey) { G.breakKey = key; G.breakP = 0; }
      const def = DEF[t.id];
      if (def.hardness !== Infinity) {
        G.breakP += dt * pickSpeed() / def.hardness;
        if (P.swing <= 0.2) { P.swing = 0.7; G.audio.dig(SOUND_KIND[t.id] === 'stone'); }
        if (G.breakP >= 1) { breakBlock(t.x, t.y, t.z); G.breakP = 0; G.breakKey = ''; }
      } else if (P.swing <= 0.2) P.swing = 0.7;
    } else { G.breakP = 0; G.breakKey = ''; }
    const placing = G.mouseR || (G.touch && G.touch.place);
    if (placing && G.placeT <= 0) { if (placeBlock()) G.placeT = 0.22; else G.placeT = 0.1; if (G.touch) G.touch.place = false; }
  }

  // ---------------- mobs (the Gloom) ----------------
  function spawnMobs(dt, daylight) {
    G.spawnT -= dt; if (G.spawnT > 0) return;
    G.spawnT = 1.5;
    if (daylight > 0.3 || G.mobs.length >= 9 || G.player.dead) return;
    const P = G.player;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 26;
      const x = Math.floor(P.pos[0] + Math.cos(a) * r), z = Math.floor(P.pos[2] + Math.sin(a) * r);
      if (x < 2 || z < 2 || x >= WX - 2 || z >= WZ - 2) continue;
      const y = G.world.surfaceY(x, z) + 1;
      if (y <= SEA + 1) continue;
      if (G.world.get(x, y, z) !== B.AIR || G.world.get(x, y + 1, z) !== B.AIR) continue;
      const below = G.world.get(x, y - 1, z); if (below === B.LANTERN || below === B.WATER) continue;
      // lanterns nearby prevent spawning
      let lit = false; for (let dx = -4; dx <= 4 && !lit; dx++) for (let dz = -4; dz <= 4 && !lit; dz++) for (let dy = -2; dy <= 3; dy++) if (G.world.get(x + dx, y + dy, z + dz) === B.LANTERN) { lit = true; break; }
      if (lit) continue;
      G.mobs.push({ pos: [x + 0.5, y, z + 0.5], vel: [0, 0, 0], yaw: Math.random() * 6.28, hp: 10, w: 0.32, h: 1.45, onGround: false, attackT: 1, hurtT: 0, wanderT: 0, wander: [0, 0], bob: Math.random() * 6, jumpT: 0 });
      if (Math.random() < 0.5) G.audio.growl();
      break;
    }
  }
  function updateMobs(dt, daylight) {
    const P = G.player;
    for (let i = G.mobs.length - 1; i >= 0; i--) {
      const m = G.mobs[i];
      const dx = P.pos[0] - m.pos[0], dz = P.pos[2] - m.pos[2]; const dist = Math.hypot(dx, dz);
      if (dist > 72) { G.mobs.splice(i, 1); continue; }
      if (daylight > 0.55) { m.hp -= dt * 5; if (Math.random() < dt * 8) G.particles.push({ pos: [m.pos[0], m.pos[1] + 1.2, m.pos[2]], vel: [(Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5)], life: 0.7, col: [1, 0.5, 0.1] }); if (m.hp <= 0) { killMob(m, false); continue; } }
      let tx = 0, tz = 0, speed = 0;
      if (dist < 30 && !P.dead) { tx = dx / (dist || 1); tz = dz / (dist || 1); speed = 3.1; m.yaw = Math.atan2(-tx, -tz); }
      else { m.wanderT -= dt; if (m.wanderT <= 0) { m.wanderT = 2 + Math.random() * 3; const a = Math.random() * 6.28; m.wander = Math.random() < 0.6 ? [Math.cos(a), Math.sin(a)] : [0, 0]; m.yaw = Math.atan2(-m.wander[0], -m.wander[1]); } tx = m.wander[0]; tz = m.wander[1]; speed = 1.2; }
      const inWater = G.world.get(Math.floor(m.pos[0]), Math.floor(m.pos[1] + 0.3), Math.floor(m.pos[2])) === B.WATER;
      const f = 1 - Math.exp(-(m.onGround ? 10 : 6) * dt);
      m.vel[0] = lerp(m.vel[0], tx * speed, f); m.vel[2] = lerp(m.vel[2], tz * speed, f);
      if (inWater) { m.vel[1] = Math.max(m.vel[1] - 8 * dt, -2); if (Math.random() < 0.5) m.vel[1] = Math.min(m.vel[1] + 20 * dt, 3); }
      else { m.vel[1] -= 32 * dt; m.vel[1] = Math.max(m.vel[1], -60); }
      const wasG = m.onGround;
      const blocked = moveEntity(m, dt);
      m.jumpT -= dt;
      if (blocked && m.onGround && m.jumpT <= 0 && speed > 0) { m.vel[1] = 9.2; m.jumpT = 0.4; }
      if (m.hurtT > 0) m.hurtT -= dt;
      m.attackT -= dt;
      m.bob += dt * Math.hypot(m.vel[0], m.vel[2]) * 2;
      if (dist < 1.25 && Math.abs(P.pos[1] - m.pos[1]) < 1.6 && m.attackT <= 0 && !P.dead) { m.attackT = 1.1; hurt(3, m.pos); }
      else if (dist < 12 && Math.random() < dt * 0.08) G.audio.growl();
    }
  }
  function updateParticles(dt) {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i]; p.life -= dt; if (p.life <= 0) { G.particles.splice(i, 1); continue; }
      p.vel[1] -= 20 * dt;
      const nx = p.pos[0] + p.vel[0] * dt, ny = p.pos[1] + p.vel[1] * dt, nz = p.pos[2] + p.vel[2] * dt;
      if (DEF[G.world.get(Math.floor(nx), Math.floor(ny), Math.floor(nz))].solid) { p.vel[0] *= 0.5; p.vel[2] *= 0.5; p.vel[1] = 0; } else { p.pos[0] = nx; p.pos[1] = ny; p.pos[2] = nz; }
    }
  }

  window.GameCore = { G, placeBlock, raycast, invAdd, invHas, invTake, selectedBlock, msg, daylightAt, updatePlayer, updateInteraction, spawnMobs, updateMobs, updateParticles, eyePos, lookDir, hurt, RECIPES, TOTAL_SHARDS, DAY_LENGTH, SAVE_KEY, clamp, lerp, smooth, $ };
})();
