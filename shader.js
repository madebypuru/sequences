'use strict';

(function () {
  const MODES = {
    photo: { id: 0, mark: '', weight: () => 0 },
    stretchH: { id: 1, mark: '*', weight: (aspect) => (aspect >= 1 ? 0.4 : 0.2) },
    stretchV: { id: 2, mark: '*', weight: (aspect) => (aspect >= 1 ? 0.2 : 0.4) },
    mono: { id: 3, mark: '°', weight: () => 1 },
    glass: { id: 4, mark: '#', weight: () => 1 },
    rotate: { id: 5, mark: '@', weight: (aspect) => 0.8 / Math.max(aspect, 1 / aspect) },
    tilt: { id: 6, mark: '/', weight: () => 0.6 },
  };

  const VERT = `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec2 uSize;
out vec2 vPx;
void main() {
  vPx = uRect.xy + aPos * uRect.zw;
  vec2 clip = vPx / uSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

  // Every mode maps a canvas pixel to a canvas pixel of the photo (then through the cover
  // transform to the source), so all panes sample the same picture at their own position.
  const FRAG = `#version 300 es
precision highp float;
in vec2 vPx;
uniform sampler2D uTex;
uniform vec4 uCover;   // sc, ox, oy, lod
uniform vec2 uSrc;     // source px size
uniform vec4 uRect;    // cell x, y, w, h in canvas px
uniform vec3 uPaper;
uniform float uK;      // canvas scale relative to 1080
uniform int uMode, uPrev;
uniform float uMix, uSample, uSeed, uAge, uTurn;
out vec4 outColor;

const float PI = 3.14159265;

vec3 photoAt(vec2 px) {
  vec2 uv = (px - uCover.yz) / uCover.x / uSrc;
  return textureLod(uTex, clamp(uv, 0.0, 1.0), uCover.w).rgb;
}

float ease(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

vec3 mono(vec2 px) {
  float l = dot(photoAt(px), vec3(0.2126, 0.7152, 0.0722));
  float c = mix(l, smoothstep(0.0, 1.0, l), 0.45);
  return mix(vec3(0.075), uPaper, pow(c, 1.08));
}

vec3 glass(vec2 px) {
  bool vertical = fract(uSeed * 7.31) < 0.5;
  float ribW = mix(14.0, 28.0, fract(uSeed * 13.7)) * uK;
  vec2 axis = vertical ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 along = vec2(axis.y, axis.x);
  vec2 o = px - uRect.xy;
  float u = dot(o, axis) / ribW;
  float f = fract(u) - 0.5;
  float bent = (floor(u) + 0.5 + 1.7 * f + 2.4 * f * f * f) * ribW;
  vec3 col = vec3(0.0);
  for (int i = -2; i <= 2; i++) {
    vec2 q = uRect.xy + axis * (bent + float(i) * ribW * 0.1) + along * dot(o, along);
    col += photoAt(q);
  }
  col /= 5.0;
  float seam = smoothstep(0.36, 0.5, abs(f));
  float lit = pow(max(0.0, 1.0 - abs(f + 0.22) * 5.0), 2.0);
  col *= 1.0 - 0.14 * seam;
  return mix(col, uPaper, 0.05 + 0.16 * lit);
}

vec3 rotated(vec2 px) {
  float q = 1.0 + floor(fract(uSeed * 5.17) * 3.0);
  float th = q * 0.5 * PI * ease(uAge / uTurn);
  vec2 c = uRect.xy + uRect.zw * 0.5;
  float cs = abs(cos(th)), sn = abs(sin(th));
  float w = uRect.z, h = uRect.w;
  float z = max(cs + sn * h / w, cs + sn * w / h);
  vec2 d = (px - c) / z;
  vec2 r = vec2(cos(th) * d.x + sin(th) * d.y, -sin(th) * d.x + cos(th) * d.y);
  return photoAt(c + r);
}

vec3 tilted(vec2 px) {
  int hinge = int(floor(fract(uSeed * 3.91) * 4.0));
  vec2 org, a, b;
  float L, M;
  if (hinge == 0) { org = uRect.xy; a = vec2(1, 0); b = vec2(0, 1); L = uRect.z; M = uRect.w; }
  else if (hinge == 1) { org = uRect.xy + vec2(uRect.z, 0); a = vec2(-1, 0); b = vec2(0, 1); L = uRect.z; M = uRect.w; }
  else if (hinge == 2) { org = uRect.xy; a = vec2(0, 1); b = vec2(1, 0); L = uRect.w; M = uRect.z; }
  else { org = uRect.xy + vec2(0, uRect.w); a = vec2(0, -1); b = vec2(1, 0); L = uRect.w; M = uRect.z; }
  float phi = radians(35.0) * ease(uAge / uTurn);
  float D = 2.4 * max(L, M);
  vec2 o = px - org;
  float sx = dot(o, a), sy = dot(o, b);
  float cx = 0.5 * L, cy = 0.5 * M;
  float den = D * cos(phi) - (sx - cx) * sin(phi);
  float u = D * sx / den;
  float s = D / (u * sin(phi) + D);
  float v = cy + (sy - cy) / s;
  vec2 g = vec2(u, v);
  vec2 inside = min(g, vec2(L, M) - g);
  float aa = min(inside.x / max(fwidth(u), 1e-3), inside.y / max(fwidth(v), 1e-3));
  float cover = den > 0.0 ? clamp(aa + 0.5, 0.0, 1.0) : 0.0;
  vec3 col = photoAt(org + a * u + b * v);
  col *= 1.0 - 0.22 * (u / L) * sin(phi) / sin(radians(35.0));
  vec3 behind = mono(px) * 0.78;
  return mix(behind, col, cover);
}

vec3 effect(int m, vec2 px) {
  if (m == 1) return photoAt(vec2(uRect.x + uSample * uRect.z, px.y));
  if (m == 2) return photoAt(vec2(px.x, uRect.y + uSample * uRect.w));
  if (m == 3) return mono(px);
  if (m == 4) return glass(px);
  if (m == 5) return rotated(px);
  if (m == 6) return tilted(px);
  return photoAt(px);
}

void main() {
  vec3 col = effect(uMode, vPx);
  if (uPrev != uMode && uMix < 1.0) col = mix(effect(uPrev, vPx), col, ease(uMix));
  outColor = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  function rgb(paper) {
    if (Array.isArray(paper)) return paper;
    const h = String(paper).replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  const idOf = (name) => (MODES[name] || MODES.photo).id;

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, antialias: false });
    if (!gl) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of ['uTex', 'uCover', 'uSrc', 'uRect', 'uPaper', 'uK', 'uMode', 'uPrev', 'uMix', 'uSample', 'uSeed', 'uAge', 'uTurn', 'uSize'])
      U[n] = gl.getUniformLocation(prog, n);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    function draw({ source, cover, width, height, paper, cells, fps = 30 }) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      const P = rgb(paper);
      gl.clearColor(P[0], P[1], P[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!source || !cover) return;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform1i(U.uTex, 0);
      gl.uniform2f(U.uSize, width, height);
      gl.uniform4f(U.uCover, cover.sc, cover.ox, cover.oy, Math.max(0, Math.log2(1 / cover.sc)));
      gl.uniform2f(U.uSrc, cover.sw, cover.sh);
      gl.uniform3f(U.uPaper, P[0], P[1], P[2]);
      gl.uniform1f(U.uK, Math.min(width, height) / 1080);
      gl.uniform1f(U.uTurn, 12 * fps / 30);
      for (const c of cells) {
        if (c.w <= 0 || c.h <= 0) continue;
        const mode = idOf(c.mode);
        gl.uniform4f(U.uRect, c.x, c.y, c.w, c.h);
        gl.uniform1i(U.uMode, mode);
        gl.uniform1i(U.uPrev, c.prev == null ? mode : idOf(c.prev));
        gl.uniform1f(U.uMix, c.mix == null ? 1 : c.mix);
        gl.uniform1f(U.uSample, c.sample || 0);
        gl.uniform1f(U.uSeed, c.seed || 0);
        gl.uniform1f(U.uAge, c.age || 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    return { draw, gl };
  }

  window.Shader = { create, MODES };
})();
