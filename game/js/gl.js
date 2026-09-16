// WebGL2 renderer: chunks, sky, entities, overlays. No dependencies.
(function () {
  const { ATLAS_COLS, ATLAS_ROWS, T } = Blocks;

  // ---------- tiny mat4 ----------
  const M4 = {
    identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    perspective(fov, aspect, near, far) {
      const f = 1 / Math.tan(fov / 2), m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far); return m;
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      }
      return o;
    },
    translate(x, y, z) { const m = M4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    scale(x, y, z) { const m = M4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
    rotY(a) { const m = M4.identity(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    rotX(a) { const m = M4.identity(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    rotZ(a) { const m = M4.identity(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    view(pos, yaw, pitch) { // camera looking along yaw/pitch
      // view = rotX(-pitch) * rotY(-yaw) * translate(-pos)
      return M4.mul(M4.rotX(-pitch), M4.mul(M4.rotY(-yaw), M4.translate(-pos[0], -pos[1], -pos[2])));
    }
  };

  const BLOCK_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in float aLight; layout(location=3) in float aGlow;
  uniform mat4 uVP; uniform mat4 uModel; uniform vec3 uCamPos;
  out vec2 vUV; out float vLight; out float vGlow; out vec3 vWorld;
  void main(){ vec4 w = uModel * vec4(aPos,1.0); vWorld = w.xyz; vUV = aUV; vLight = aLight; vGlow = aGlow; gl_Position = uVP * w; }`;
  const BLOCK_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; in float vLight; in float vGlow; in vec3 vWorld;
  uniform sampler2D uTex; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
  uniform float uDaylight; uniform vec3 uCamPos; uniform float uTorch; uniform float uAlpha; uniform vec3 uTint; uniform float uNoFog; uniform vec4 uWrap;
  out vec4 fragColor;
  void main(){
    vec2 uv = vUV;
    if (uWrap.z > 0.0) uv = uWrap.xy + fract(vUV) * uWrap.zw;
    vec4 tex = texture(uTex, uv);
    if (tex.a < 0.05) discard;
    float amb = mix(0.16, 1.0, uDaylight);
    float d = distance(vWorld, uCamPos);
    float torch = uTorch * pow(clamp(1.0 - d / 11.0, 0.0, 1.0), 1.6);
    float light = clamp(vLight * amb + torch * vLight * 1.6, 0.0, 1.15);
    vec3 col = tex.rgb * light;
    col = mix(col, tex.rgb * 1.15, vGlow);
    col *= uTint * mix(vec3(0.78, 0.82, 1.1), vec3(1.0), uDaylight);
    float fog = smoothstep(uFogNear, uFogFar, d) * (1.0 - uNoFog);
    col = mix(col, uFogColor, fog);
    fragColor = vec4(col, tex.a * uAlpha);
  }`;
  const SKY_VS = `#version 300 es
  precision highp float; layout(location=0) in vec2 aPos; out vec2 vP; void main(){ vP = aPos; gl_Position = vec4(aPos,0.999,1.0); }`;
  const SKY_FS = `#version 300 es
  precision highp float; in vec2 vP; out vec4 fragColor;
  uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp; uniform float uTanH; uniform float uTanV;
  uniform vec3 uSunDir; uniform float uDaylight; uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uTime; uniform float uUnderwater;
  float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p += dot(p,p.yzx+19.19); return fract((p.x+p.y)*p.z); }
  void main(){
    vec3 dir = normalize(uFwd + uRight * vP.x * uTanH + uUp * vP.y * uTanV);
    float h = clamp(dir.y, -1.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(max(h,0.0), 0.55));
    if (h < 0.0) col = mix(uHorizon, uZenith*0.6, min(1.0, -h*2.0));
    float sd = dot(dir, uSunDir);
    // sun glow near horizon
    float glow = pow(max(sd,0.0), 8.0) * (1.0 - uDaylight*0.6) * 0.6;
    col += vec3(1.0, 0.55, 0.25) * glow * max(0.0, 1.0 - abs(h)*3.0);
    // sun disc
    float sun = smoothstep(0.9985, 0.9992, sd);
    col = mix(col, vec3(1.0,0.97,0.85), sun);
    col += vec3(1.0,0.9,0.7) * pow(max(sd,0.0), 60.0) * 0.35;
    // moon (opposite)
    float md = dot(dir, -uSunDir);
    float moon = smoothstep(0.9988, 0.9994, md);
    col = mix(col, vec3(0.92,0.93,0.98), moon * (1.0-uDaylight));
    // stars
    if (uDaylight < 0.5 && h > 0.0) {
      vec3 g = floor(dir * 140.0);
      float s = hash(g);
      float star = step(0.995, s) * (0.5 + 0.5*sin(uTime*2.0 + s*100.0));
      col += vec3(star) * (1.0 - uDaylight*2.0) * 0.9 * step(0.0, h);
    }
    col = mix(col, vec3(0.05,0.2,0.45), uUnderwater);
    fragColor = vec4(col, 1.0);
  }`;
  const COLOR_VS = `#version 300 es
  precision highp float; layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol;
  uniform mat4 uVP; uniform float uPointSize; out vec4 vCol; out vec3 vWorld;
  void main(){ vCol = aCol; vWorld = aPos; gl_Position = uVP * vec4(aPos,1.0); gl_PointSize = uPointSize / max(gl_Position.w, 0.1); }`;
  const COLOR_FS = `#version 300 es
  precision highp float; in vec4 vCol; in vec3 vWorld; out vec4 fragColor;
  uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec3 uCamPos; uniform float uDaylight;
  void main(){ float d = distance(vWorld, uCamPos); float fog = smoothstep(uFogNear, uFogFar, d);
    vec3 c = vCol.rgb * mix(0.25, 1.0, uDaylight); fragColor = vec4(mix(c, uFogColor, fog), vCol.a); }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  class Renderer {
    constructor(canvas, atlasCanvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 not supported');
      this.gl = gl;
      this.block = program(gl, BLOCK_VS, BLOCK_FS);
      this.sky = program(gl, SKY_VS, SKY_FS);
      this.color = program(gl, COLOR_VS, COLOR_FS);
      // atlas
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // sky quad
      this.skyVao = gl.createVertexArray(); gl.bindVertexArray(this.skyVao);
      const sb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.chunks = new Map();
      this.dyn = this.makeDyn(); // entities
      this.dynHeld = this.makeDyn();
      this.dynCloud = this.makeDyn();
      this.dynOverlay = this.makeDyn();
      this.lineVao = gl.createVertexArray(); this.lineBuf = gl.createBuffer();
      gl.bindVertexArray(this.lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);
      this.fov = 70 * Math.PI / 180;
      this.stats = { chunksDrawn: 0, tris: 0 };
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    makeDyn() {
      const gl = this.gl;
      const vao = gl.createVertexArray(), vb = gl.createBuffer(), ib = gl.createBuffer();
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      this.setBlockAttribs(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bindVertexArray(null);
      return { vao, vb, ib, count: 0 };
    }
    setBlockAttribs() {
      const gl = this.gl, S = 28;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 24);
    }
    uploadDyn(dyn, verts, idx) {
      const gl = this.gl;
      gl.bindVertexArray(dyn.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, dyn.vb); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dyn.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      dyn.count = idx.length; gl.bindVertexArray(null);
    }
    uploadChunk(cx, cz, mesh) {
      const gl = this.gl; const key = cx + ',' + cz;
      let c = this.chunks.get(key);
      if (!c) {
        c = { op: this.makeDyn(), tr: this.makeDyn(), cx, cz };
        this.chunks.set(key, c);
      }
      this.uploadDyn(c.op, mesh.opaque, mesh.opaqueIdx);
      this.uploadDyn(c.tr, mesh.trans, mesh.transIdx);
    }
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.gl.viewport(0, 0, w, h);
    }
    // frustum planes from VP matrix
    frustum(vp) {
      const p = [];
      const m = vp;
      const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
      const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
      const add = (a, b, s) => p.push([r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]]);
      add(r0, null, 1); add(r0, null, -1); add(r1, null, 1); add(r1, null, -1); add(r2, null, 1); add(r2, null, -1);
      for (const pl of p) { const l = Math.hypot(pl[0], pl[1], pl[2]); pl[0] /= l; pl[1] /= l; pl[2] /= l; pl[3] /= l; }
      return p;
    }
    sphereVisible(planes, x, y, z, r) {
      for (const pl of planes) if (pl[0] * x + pl[1] * y + pl[2] * z + pl[3] < -r) return false;
      return true;
    }
    render(S) {
      // S: {camPos, yaw, pitch, daylight, sunDir, fogColor, fogNear, fogFar, zenith, horizon, time, underwater, torch, world consts,
      //     entities:{verts,idx}, held:{verts,idx,model}, clouds:{verts,idx,offset}, overlay:{verts,idx}, lines:Float32Array, points:Float32Array}
      const gl = this.gl;
      this.resize();
      const aspect = this.canvas.width / this.canvas.height;
      const proj = M4.perspective(this.fov, aspect, 0.05, 420);
      const view = M4.view(S.camPos, S.yaw, S.pitch);
      const vp = M4.mul(proj, view);
      gl.clearColor(S.fogColor[0], S.fogColor[1], S.fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // ---- sky ----
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.useProgram(this.sky.p);
      const u = this.sky.u;
      const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
      const fwd = [-sy * cp, sp, -cy * cp];
      const right = [cy, 0, -sy];
      const up = [sy * sp, cp, cy * sp];
      gl.uniform3fv(u.uFwd, fwd); gl.uniform3fv(u.uRight, right); gl.uniform3fv(u.uUp, up);
      gl.uniform1f(u.uTanV, Math.tan(this.fov / 2)); gl.uniform1f(u.uTanH, Math.tan(this.fov / 2) * aspect);
      gl.uniform3fv(u.uSunDir, S.sunDir); gl.uniform1f(u.uDaylight, S.daylight);
      gl.uniform3fv(u.uZenith, S.zenith); gl.uniform3fv(u.uHorizon, S.horizon);
      gl.uniform1f(u.uTime, S.time); gl.uniform1f(u.uUnderwater, S.underwater ? 1 : 0);
      gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      // ---- blocks ----
      gl.useProgram(this.block.p);
      const b = this.block.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(b.uTex, 0);
      gl.uniformMatrix4fv(b.uVP, false, vp); gl.uniformMatrix4fv(b.uModel, false, M4.identity());
      gl.uniform3fv(b.uCamPos, S.camPos); gl.uniform3fv(b.uFogColor, S.fogColor);
      gl.uniform1f(b.uFogNear, S.fogNear); gl.uniform1f(b.uFogFar, S.fogFar);
      gl.uniform1f(b.uDaylight, S.daylight); gl.uniform1f(b.uTorch, S.torch); gl.uniform1f(b.uAlpha, 1); gl.uniform3f(b.uTint, 1, 1, 1); gl.uniform1f(b.uNoFog, 0); gl.uniform4f(b.uWrap, 0, 0, 0, 0);
      const planes = this.frustum(vp);
      const CS = WorldConst.CS, WY = WorldConst.WY;
      const visible = [];
      this.stats.chunksDrawn = 0; this.stats.tris = 0;
      for (const c of this.chunks.values()) {
        const cxw = c.cx * CS + CS / 2, czw = c.cz * CS + CS / 2;
        const dx = cxw - S.camPos[0], dz = czw - S.camPos[2];
        const dist = Math.hypot(dx, dz);
        if (dist > S.fogFar + 24) continue;
        if (!this.sphereVisible(planes, cxw, WY / 2, czw, Math.hypot(CS / 2, WY / 2, CS / 2))) continue;
        visible.push(c);
        if (c.op.count) { gl.bindVertexArray(c.op.vao); gl.drawElements(gl.TRIANGLES, c.op.count, gl.UNSIGNED_INT, 0); this.stats.tris += c.op.count / 3; }
        this.stats.chunksDrawn++;
      }
      // entities (mobs, items)
      if (S.entities && S.entities.idx.length) {
        this.uploadDyn(this.dyn, S.entities.verts, S.entities.idx);
        gl.bindVertexArray(this.dyn.vao); gl.drawElements(gl.TRIANGLES, this.dyn.count, gl.UNSIGNED_INT, 0);
      }
      // transparent pass
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      for (const c of visible) if (c.tr.count) { gl.bindVertexArray(c.tr.vao); gl.drawElements(gl.TRIANGLES, c.tr.count, gl.UNSIGNED_INT, 0); }
      // infinite ocean plane (tiled water texture)
      if (S.ocean && S.ocean.idx.length) {
        if (!this.dynOcean) { this.dynOcean = this.makeDyn(); this.uploadDyn(this.dynOcean, S.ocean.verts, S.ocean.idx); }
        gl.uniform4f(b.uWrap, (T.WATER % ATLAS_COLS) / ATLAS_COLS, Math.floor(T.WATER / ATLAS_COLS) / ATLAS_ROWS, 1 / ATLAS_COLS, 1 / ATLAS_ROWS);
        gl.bindVertexArray(this.dynOcean.vao); gl.drawElements(gl.TRIANGLES, this.dynOcean.count, gl.UNSIGNED_INT, 0);
        gl.uniform4f(b.uWrap, 0, 0, 0, 0);
      }
      // clouds
      if (S.clouds && S.clouds.idx.length) {
        if (S.clouds.dirty) { this.uploadDyn(this.dynCloud, S.clouds.verts, S.clouds.idx); S.clouds.dirty = false; }
        gl.uniformMatrix4fv(b.uModel, false, M4.translate(S.clouds.offset, 0, 0));
        gl.uniform1f(b.uAlpha, 0.85);
        gl.bindVertexArray(this.dynCloud.vao); gl.drawElements(gl.TRIANGLES, this.dynCloud.count, gl.UNSIGNED_INT, 0);
        gl.uniform1f(b.uAlpha, 1); gl.uniformMatrix4fv(b.uModel, false, M4.identity());
      }
      // crack overlay
      if (S.overlay && S.overlay.idx.length) {
        this.uploadDyn(this.dynOverlay, S.overlay.verts, S.overlay.idx);
        gl.bindVertexArray(this.dynOverlay.vao); gl.drawElements(gl.TRIANGLES, this.dynOverlay.count, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      // ---- lines / points (color shader) ----
      gl.useProgram(this.color.p); const cu = this.color.u;
      gl.uniformMatrix4fv(cu.uVP, false, vp); gl.uniform3fv(cu.uCamPos, S.camPos);
      gl.uniform3fv(cu.uFogColor, S.fogColor); gl.uniform1f(cu.uFogNear, S.fogNear); gl.uniform1f(cu.uFogFar, S.fogFar); gl.uniform1f(cu.uDaylight, S.daylight);
      gl.uniform1f(cu.uPointSize, this.canvas.height * 0.06);
      if (S.lines && S.lines.length) {
        gl.bindVertexArray(this.lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, S.lines, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, S.lines.length / 7);
      }
      if (S.points && S.points.length) {
        gl.bindVertexArray(this.lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, S.points, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, S.points.length / 7);
      }
      gl.disable(gl.BLEND);
      // ---- held item (view space) ----
      if (S.held && S.held.idx.length) {
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.block.p);
        gl.uniformMatrix4fv(b.uVP, false, proj);
        gl.uniformMatrix4fv(b.uModel, false, S.held.model);
        gl.uniform3f(b.uCamPos, 0, 0, 0); gl.uniform1f(b.uNoFog, 1); gl.uniform1f(b.uTorch, S.torch);
        if (S.held.arm) gl.uniform3f(b.uTint, 0.93, 0.72, 0.55);
        gl.enable(gl.BLEND);
        this.uploadDyn(this.dynHeld, S.held.verts, S.held.idx);
        gl.bindVertexArray(this.dynHeld.vao); gl.drawElements(gl.TRIANGLES, this.dynHeld.count, gl.UNSIGNED_INT, 0);
        gl.disable(gl.BLEND);
        gl.uniform1f(b.uNoFog, 0); gl.uniform3f(b.uTint, 1, 1, 1);
      }
      gl.bindVertexArray(null);
    }
  }

  // ---------- geometry helpers for dynamic boxes ----------
  // push a textured box into arrays. tiles: {top, bottom, side} or per-face array [px,nx,py,ny,pz,nz]
  function pushBox(verts, idx, x0, y0, z0, x1, y1, z1, tiles, light, glow, uvScale) {
    const tu = 1 / ATLAS_COLS, tv = 1 / ATLAS_ROWS;
    const faces = [
      { n: 'py', v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], s: 1.0 },
      { n: 'ny', v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], s: 0.5 },
      { n: 'px', v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], s: 0.6 },
      { n: 'nx', v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], s: 0.6 },
      { n: 'pz', v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], s: 0.8 },
      { n: 'nz', v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], s: 0.8 },
    ];
    const UVS = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const us = uvScale || 1;
    for (const F of faces) {
      const tile = tiles[F.n] !== undefined ? tiles[F.n] : (F.n === 'py' ? tiles.top : F.n === 'ny' ? tiles.bottom : tiles.side);
      const u0 = (tile % ATLAS_COLS) * tu, v0 = Math.floor(tile / ATLAS_COLS) * tv;
      const base = verts.length / 7;
      for (let c = 0; c < 4; c++) {
        const v = F.v[c];
        verts.push(v[0], v[1], v[2], u0 + UVS[c][0] * tu * us, v0 + UVS[c][1] * tv * us, F.s * light, glow);
      }
      idx.push(base, base + 1, base + 2, base + 2, base + 3, base);
    }
  }
  function pushLineBox(arr, x0, y0, z0, x1, y1, z1, r, g, b, a) {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of e) { arr.push(...c[i], r, g, b, a, ...c[j], r, g, b, a); }
  }

  window.GLR = { Renderer, M4, pushBox, pushLineBox };
})();
