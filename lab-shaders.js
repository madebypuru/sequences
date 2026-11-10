'use strict';

// Shared GLSL (ES 1.00) every pane body can use. px is a canvas pixel, top-left origin.
window.PANE_PRELUDE = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrc;
uniform vec3 uCover;
uniform vec4 uRect;
uniform vec2 uSize;
uniform float uDensity;
uniform float uTime;
uniform float uK;
uniform vec3 uPaper;
uniform float p0, p1, p2, p3;

const float PI = 3.14159265;

vec3 tap(vec2 uv) { return texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb; }

vec3 photoAt(vec2 px) {
  vec2 s = 1.0 / (uCover.x * uSrc);
  vec2 uv = (px - uCover.yz) * s;
  vec2 h = 0.25 * s / uDensity;
  return 0.25 * (tap(uv + vec2(h.x, h.y)) + tap(uv + vec2(-h.x, h.y)) + tap(uv + vec2(h.x, -h.y)) + tap(uv - h));
}

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ease(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
vec2 cellUV(vec2 px) { return (px - uRect.xy) / uRect.zw; }
vec2 cellPx(vec2 uv) { return uRect.xy + uv * uRect.zw; }
vec2 cellCenter() { return uRect.xy + uRect.zw * 0.5; }
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
`;

window.PANES = [
  {
    id: 'stretch', name: 'Stretch', family: 'In the app', mark: '*',
    what: 'One row or column of the picture smeared across the whole cell.',
    how: 'Every pixel in the cell ignores where it is along one direction and reads the same single line of the photo. That line slowly slides back and forth, so the smear changes colour over time.',
    merge: 'Sits well: the colours are the photo\'s own, and the edge of the cell lines up with the real picture.',
    params: [
      { key: 'dir', label: 'Columns', min: 0, max: 1, step: 1, value: 0 },
      { key: 'line', label: 'Line', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'drift', label: 'Drift', min: 0, max: 1, step: 0.01, value: 0.3 },
    ],
    glsl: `
  float t = mod(p1 + p2 * 0.15 * uTime, 2.0);
  t = t <= 1.0 ? t : 2.0 - t;
  if (p0 < 0.5) return photoAt(vec2(uRect.x + t * uRect.z, px.y));
  return photoAt(vec2(px.x, uRect.y + t * uRect.w));`,
  },
  {
    id: 'mono', name: 'Mono', family: 'In the app', mark: '°',
    what: 'The cell in black and white, printed on the paper colour.',
    how: 'Each pixel keeps only its brightness. A soft S-curve adds punch, then brightness picks a shade between a near-black ink and the paper.',
    merge: 'Very calm. It reads as the same photo printed differently, never as a sticker.',
    params: [
      { key: 'contrast', label: 'Contrast', min: 0, max: 1, step: 0.01, value: 0.45 },
      { key: 'ink', label: 'Ink', min: 0, max: 0.4, step: 0.01, value: 0.075 },
    ],
    glsl: `
  float l = lum(photoAt(px));
  float c = mix(l, smoothstep(0.0, 1.0, l), p0);
  return mix(vec3(p1), uPaper, pow(c, 1.08));`,
  },
  {
    id: 'glass', name: 'Reeded glass', family: 'In the app', mark: '#',
    what: 'The cell seen through ribbed glass: narrow strips, each bending the picture a little.',
    how: 'The cell is cut into ribs. Inside each rib, pixels look sideways by an amount that grows toward the rib edges, like a lens. Five nearby looks are averaged to soften it, and a thin highlight runs down each rib.',
    merge: 'Strong but believable. The picture stays recognisable, so it still belongs to the photo.',
    params: [
      { key: 'rib', label: 'Rib width', min: 6, max: 60, step: 1, value: 20 },
      { key: 'dir', label: 'Sideways', min: 0, max: 1, step: 1, value: 0 },
      { key: 'bend', label: 'Bend', min: 0, max: 3, step: 0.05, value: 1.7 },
    ],
    glsl: `
  float ribW = max(2.0, p0 * uK);
  vec2 axis = p1 < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 along = axis.yx;
  vec2 o = px - uRect.xy;
  float u = dot(o, axis) / ribW;
  float f = fract(u) - 0.5;
  float bent = (floor(u) + 0.5 + p2 * f + 2.4 * f * f * f) * ribW;
  vec3 col = vec3(0.0);
  for (int i = -2; i <= 2; i++) {
    col += photoAt(uRect.xy + axis * (bent + float(i) * ribW * 0.1) + along * dot(o, along));
  }
  col /= 5.0;
  float seam = smoothstep(0.36, 0.5, abs(f));
  float lit = pow(max(0.0, 1.0 - abs(f + 0.22) * 5.0), 2.0);
  col *= 1.0 - 0.14 * seam;
  return mix(col, uPaper, 0.05 + 0.16 * lit);`,
  },
  {
    id: 'rotate', name: 'Rotate', family: 'In the app', mark: '@',
    what: 'The cell\'s own patch of picture turned by quarter turns.',
    how: 'Each pixel turns its position around the cell centre the opposite way before looking up the photo, so the patch appears turned. It zooms in just enough that no corner ever shows empty.',
    merge: 'Clearly a deliberate move. Works best on texture (leaves, water) where the turn is a surprise, not a mistake.',
    params: [
      { key: 'turns', label: 'Quarters', min: 1, max: 3, step: 1, value: 1 },
      { key: 'progress', label: 'Progress', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'loop', label: 'Animate', min: 0, max: 1, step: 1, value: 0 },
    ],
    glsl: `
  float pr = p2 > 0.5 ? abs(fract(uTime * 0.2) * 2.0 - 1.0) : p1;
  float th = floor(p0 + 0.5) * 0.5 * PI * ease(pr);
  vec2 c = cellCenter();
  float cs = abs(cos(th)), sn = abs(sin(th));
  float w = uRect.z, h = uRect.w;
  float z = max(cs + sn * h / w, cs + sn * w / h);
  vec2 d = (px - c) / z;
  vec2 r = vec2(cos(th) * d.x + sin(th) * d.y, -sin(th) * d.x + cos(th) * d.y);
  return photoAt(c + r);`,
  },
  {
    id: 'tilt', name: 'Tilt', family: 'In the app', mark: '/',
    what: 'The cell as a card hinged on one edge and tipped back, with a grey print showing behind it.',
    how: 'Each pixel works out where it would land on a tipped card using simple perspective, then reads the photo there. Where the card no longer covers, a dimmed black and white copy shows through.',
    merge: 'The most 3D pane. Reads as an object on top of the photo, which is the point, but use it sparingly.',
    params: [
      { key: 'angle', label: 'Angle', min: 0, max: 60, step: 1, value: 35 },
      { key: 'hinge', label: 'Hinge', min: 0, max: 3, step: 1, value: 0 },
    ],
    glsl: `
  int hinge = int(floor(p1 + 0.5));
  vec2 org = uRect.xy; vec2 a = vec2(1.0, 0.0); vec2 b = vec2(0.0, 1.0);
  float L = uRect.z, M = uRect.w;
  if (hinge == 1) { org = uRect.xy + vec2(uRect.z, 0.0); a = vec2(-1.0, 0.0); }
  if (hinge == 2) { a = vec2(0.0, 1.0); b = vec2(1.0, 0.0); L = uRect.w; M = uRect.z; }
  if (hinge == 3) { org = uRect.xy + vec2(0.0, uRect.w); a = vec2(0.0, -1.0); b = vec2(1.0, 0.0); L = uRect.w; M = uRect.z; }
  float phi = radians(max(p0, 0.01));
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
  float cover = den > 0.0 ? clamp(min(inside.x, inside.y) + 0.5, 0.0, 1.0) : 0.0;
  vec3 col = photoAt(org + a * u + b * v);
  col *= 1.0 - 0.22 * (u / L) * sin(phi) / sin(radians(35.0));
  vec3 behind = mix(vec3(0.075), uPaper, lum(photoAt(px))) * 0.78;
  return mix(behind, col, cover);`,
  },

  {
    id: 'duotone', name: 'Duotone', family: 'Tone', mark: '%',
    what: 'The cell printed in two inks: one coloured dark ink and the paper.',
    how: 'Each pixel keeps only its brightness. Dark pixels take the ink colour, light ones take the paper colour, and everything between is a blend of the two.',
    merge: 'Sits well when the ink is close to a colour already in the photo. A far-off hue looks like a poster pasted on.',
    params: [
      { key: 'hue', label: 'Ink hue', min: 0, max: 1, step: 0.01, value: 0.62 },
      { key: 'depth', label: 'Ink depth', min: 0, max: 1, step: 0.01, value: 0.35 },
      { key: 'contrast', label: 'Contrast', min: 0, max: 1, step: 0.01, value: 0.3 },
    ],
    glsl: `
  float l = lum(photoAt(px));
  l = mix(l, smoothstep(0.05, 0.95, l), p2);
  vec3 ink = hue(p0) * mix(0.6, 0.12, p1);
  return mix(ink, uPaper, l);`,
  },
  {
    id: 'posterize', name: 'Posterize', family: 'Tone', mark: '=',
    what: 'Smooth shading broken into a few flat steps, like screen-printed colour.',
    how: 'Each colour channel is rounded to the nearest of a few allowed levels, so gradients turn into bands. A slider fades between rounding the colour and rounding just the grey.',
    merge: 'Medium. Few levels look graphic and loud. Five or six levels stay close to the photo.',
    params: [
      { key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, value: 4 },
      { key: 'colour', label: 'Colour', min: 0, max: 1, step: 0.01, value: 1 },
    ],
    glsl: `
  vec3 c = photoAt(px);
  float n = floor(p0 + 0.5) - 1.0;
  vec3 q = floor(c * n + 0.5) / n;
  float g = floor(lum(c) * n + 0.5) / n;
  return mix(mix(vec3(0.07), uPaper, g), q, p1);`,
  },
  {
    id: 'dither', name: 'Dither', family: 'Tone', mark: ':',
    what: 'Only ink or paper per pixel, with greys made from a fine regular dot pattern, like an old Mac screen.',
    how: 'Each pixel looks up its brightness and keeps only black or white, using a tiny repeating pattern of thresholds so mid-greys become dots. Bigger dot size groups pixels into chunkier squares first.',
    merge: 'Reads as a print technique, so it pairs well with Mono. At large dot sizes it starts to feel like a game screen.',
    params: [
      { key: 'size', label: 'Dot size', min: 1, max: 8, step: 1, value: 2 },
      { key: 'bias', label: 'Lighter', min: -0.3, max: 0.4, step: 0.01, value: 0.1 },
      { key: 'colour', label: 'Colour', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    glsl: `
  float s = max(1.0, floor(p0 * uK * 1.5 + 0.5));
  vec2 id = floor((px - uRect.xy) / s);
  vec3 c = photoAt(uRect.xy + (id + 0.5) * s);
  float t = bayer8(id);
  float g = step(t, lum(c) + p1);
  vec3 rgb = step(vec3(t), c + p1);
  return mix(vec3(0.07), uPaper, mix(vec3(g), rgb, p2));`,
  },
  {
    id: 'halftone', name: 'Halftone', family: 'Tone', mark: '.',
    what: 'The picture rebuilt from round ink dots on a tilted grid, like newsprint.',
    how: 'The cell is covered by a grid of circles. Each circle reads the photo at its centre: darker means a bigger dot. Mid-tones are lifted a little, as printers do, so dark photos do not fill in. The grid is tilted so the dots do not line up with the cell edge.',
    merge: 'Reads as print, like Mono. Big dots turn into a pattern that competes with the label, so keep them small.',
    params: [
      { key: 'size', label: 'Grid size', min: 4, max: 30, step: 1, value: 9 },
      { key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, value: 45 },
      { key: 'colour', label: 'Colour', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    glsl: `
  float s = max(3.0, p0 * uK * 1.5);
  float a = radians(p1);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 g = R * (px - uRect.xy) / s;
  vec2 id = floor(g) + 0.5;
  vec3 c = photoAt(uRect.xy + (id * s) * R);
  float d = length(fract(g) - 0.5);
  float r = 0.68 * sqrt(1.0 - pow(lum(c), 0.65));
  float w = 0.8 / s;
  float dotv = 1.0 - smoothstep(r - w, r + w, d);
  vec3 ink = mix(vec3(0.07), c * 0.85, p2);
  return mix(uPaper, ink, dotv);`,
  },
  {
    id: 'ink', name: 'Ink', family: 'Tone', mark: '!',
    what: 'A hard two-colour cut: every pixel is either ink or paper, like a stencil.',
    how: 'Each pixel compares its brightness with a level and becomes ink below it and paper above. The level can follow the local average so dark and light areas both keep some detail.',
    merge: 'Loud. A good accent once in a grid. Low "Follow" on a dark photo can go mostly ink.',
    params: [
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'soft', label: 'Softness', min: 0.01, max: 0.3, step: 0.01, value: 0.04 },
      { key: 'follow', label: 'Follow', min: 0, max: 1, step: 0.01, value: 0.6 },
    ],
    glsl: `
  float l = lum(photoAt(px));
  float R = 28.0 * uK;
  float m = 0.25 * (lum(photoAt(px + vec2(R, 0.0))) + lum(photoAt(px - vec2(R, 0.0))) + lum(photoAt(px + vec2(0.0, R))) + lum(photoAt(px - vec2(0.0, R))));
  float t = mix(p0, m, p2);
  return mix(vec3(0.07), uPaper, smoothstep(t - p1, t + p1, l));`,
  },
  {
    id: 'negative', name: 'Negative', family: 'Tone', mark: '±',
    what: 'Colours flipped, like a film negative: light becomes dark, blue becomes orange.',
    how: 'Each colour channel is subtracted from full brightness. A slider blends between the photo and its negative, another lifts it toward the paper so it never goes harsh.',
    merge: 'Weak. Inverted colour almost always looks like a different picture. Strongest as a short flash during a change.',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'lift', label: 'Lift', min: 0, max: 0.5, step: 0.01, value: 0.1 },
    ],
    glsl: `
  vec3 c = photoAt(px);
  vec3 n = mix(c, vec3(1.0) - c, p0);
  return mix(n, uPaper, p1);`,
  },

  {
    id: 'frosted', name: 'Frosted glass', family: 'Optics', mark: '≈',
    what: 'The cell seen through sandblasted glass: soft, grainy, with a faint white haze.',
    how: 'Each small patch of pixels looks up the photo at a few random spots nearby and averages them. The random spots stay fixed, so the grain is still, not flickering.',
    merge: 'Sits very well. It reads as a material in front of the photo. Good next to the clean primary block.',
    params: [
      { key: 'amount', label: 'Spread', min: 0, max: 40, step: 1, value: 12 },
      { key: 'grain', label: 'Grain', min: 1, max: 6, step: 0.1, value: 1.5 },
      { key: 'haze', label: 'Haze', min: 0, max: 0.4, step: 0.01, value: 0.1 },
    ],
    glsl: `
  vec2 cellq = floor(px / max(1.0, p1 * uK));
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 j = vec2(hash(cellq + vec2(fi * 17.1, fi * 5.3)), hash(cellq + vec2(fi * 3.7 + 41.0, fi * 13.9))) - 0.5;
    col += photoAt(px + j * 2.0 * p0 * uK);
  }
  return mix(col / 8.0, uPaper, p2);`,
  },
  {
    id: 'lens', name: 'Lens', family: 'Optics', mark: '+',
    what: 'A magnifying glass held over the cell: the middle bulges up, the rim stays in place.',
    how: 'Pixels near the centre look up the photo closer to the centre than they are, which enlarges it. The effect fades to nothing at the lens edge, so the picture joins up with the outside.',
    merge: 'Sits well because the edge of the cell matches the photo exactly. Best on a detail worth enlarging.',
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 0.9, step: 0.01, value: 0.55 },
      { key: 'radius', label: 'Radius', min: 0.2, max: 1.2, step: 0.01, value: 0.9 },
    ],
    glsl: `
  vec2 c = cellCenter();
  float R = p1 * 0.5 * min(uRect.z, uRect.w);
  vec2 d = px - c;
  float r = length(d) / R;
  float k = r < 1.0 ? 1.0 - p0 * (1.0 - r * r) : 1.0;
  vec3 col = photoAt(c + d * k);
  float rim = smoothstep(0.9, 1.0, r) * (1.0 - smoothstep(1.0, 1.06, r));
  return mix(col, uPaper, 0.18 * rim);`,
  },
  {
    id: 'fisheye', name: 'Fisheye', family: 'Optics', mark: ')',
    what: 'A wide-angle bend across the whole cell: centre swollen, edges squeezed. Negative values pinch instead.',
    how: 'Each pixel measures how far it is from the cell centre. The farther out, the more its lookup is pushed outward (or inward when negative), the way a curved lens bends light.',
    merge: 'Medium. The cell edges no longer meet the photo, so it reads as a separate window. Small values hide that.',
    params: [
      { key: 'strength', label: 'Strength', min: -1, max: 1, step: 0.01, value: 0.6 },
    ],
    glsl: `
  vec2 q = (px - cellCenter()) / (0.5 * uRect.zw);
  float r2 = dot(q, q);
  vec2 qs = q * (1.0 + p0 * 0.35 * (r2 - 1.0));
  return photoAt(cellCenter() + qs * 0.5 * uRect.zw);`,
  },
  {
    id: 'split', name: 'Colour split', family: 'Optics', mark: '&',
    what: 'Red, green and blue pulled apart, leaving coloured fringes on every edge.',
    how: 'Each pixel reads red from a spot a little to one side, blue from the other side, and green from where it is. Set "Radial" to push the fringes outward from the centre like a cheap lens.',
    merge: 'Medium. Small splits look like a camera artifact and blend in. Large splits look like an effect.',
    params: [
      { key: 'dist', label: 'Distance', min: 0, max: 30, step: 0.5, value: 8 },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, value: 0 },
      { key: 'radial', label: 'Radial', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    glsl: `
  vec2 dir = vec2(cos(radians(p1)), sin(radians(p1)));
  vec2 rd = (px - cellCenter()) / (0.5 * min(uRect.z, uRect.w));
  vec2 off = mix(dir, rd, p2) * p0 * uK;
  return vec3(photoAt(px + off).r, photoAt(px).g, photoAt(px - off).b);`,
  },
  {
    id: 'ripple', name: 'Ripple', family: 'Optics', mark: '~',
    what: 'Rings spreading from the cell centre, like a stone dropped in water.',
    how: 'Each pixel measures its distance from the centre and wobbles its lookup in and out along that line by a wave. The wave moves with time, so the rings travel outward.',
    merge: 'Sits well at low amplitude: the photo stays intact and just shimmers. High amplitude looks like a screensaver.',
    params: [
      { key: 'amp', label: 'Amplitude', min: 0, max: 20, step: 0.5, value: 5 },
      { key: 'wave', label: 'Wavelength', min: 10, max: 120, step: 1, value: 40 },
      { key: 'speed', label: 'Speed', min: 0, max: 3, step: 0.05, value: 0.8 },
    ],
    glsl: `
  vec2 c = cellCenter();
  vec2 d = px - c;
  float r = length(d);
  float ph = r / (p1 * uK) * 2.0 * PI - uTime * p2 * 2.0 * PI;
  vec2 n = r > 0.001 ? d / r : vec2(0.0);
  vec3 col = photoAt(px + n * sin(ph) * p0 * uK);
  return col * (1.0 + 0.05 * cos(ph) * step(0.01, p0));`,
  },
  {
    id: 'prism', name: 'Prism', family: 'Optics', mark: '^',
    what: 'A kaleidoscope: one wedge of the picture mirrored round the centre into a star.',
    how: 'Each pixel works out its angle around the centre, folds that angle into one narrow wedge, and mirrors it. Every wedge then shows the same slice of the photo. The slice can turn slowly.',
    merge: 'Weak. It invents symmetry the photo never had, so it looks pasted on. Strong as a rare accent.',
    params: [
      { key: 'segments', label: 'Segments', min: 2, max: 12, step: 1, value: 6 },
      { key: 'spin', label: 'Spin', min: 0, max: 1, step: 0.01, value: 0.15 },
      { key: 'zoom', label: 'Zoom', min: 0.5, max: 2, step: 0.01, value: 1 },
    ],
    glsl: `
  vec2 c = cellCenter();
  vec2 d = px - c;
  float r = length(d);
  float a = atan(d.y, d.x) + uTime * p1;
  float seg = 2.0 * PI / floor(p0 + 0.5);
  a = mod(a, seg);
  a = min(a, seg - a);
  return photoAt(c + vec2(cos(a), sin(a)) * r / p2);`,
  },

  {
    id: 'mirror', name: 'Mirror', family: 'Geometry', mark: '|',
    what: 'One half of the cell reflected onto the other, like a mirror stood on edge.',
    how: 'Pixels on one side of a line read the photo normally. Pixels on the other side read the spot the same distance back across the line.',
    merge: 'Medium. The unmirrored half joins the photo, the mirrored half gives it away. Faces and animals look uncanny.',
    params: [
      { key: 'axis', label: 'Up-down', min: 0, max: 1, step: 1, value: 0 },
      { key: 'pos', label: 'Position', min: 0.2, max: 0.8, step: 0.01, value: 0.5 },
      { key: 'side', label: 'Other side', min: 0, max: 1, step: 1, value: 0 },
    ],
    glsl: `
  vec2 uv = cellUV(px);
  float x = p0 < 0.5 ? uv.x : uv.y;
  bool keep = p2 < 0.5 ? x < p1 : x > p1;
  if (!keep) x = 2.0 * p1 - x;
  if (p0 < 0.5) uv.x = x; else uv.y = x;
  return photoAt(cellPx(uv));`,
  },
  {
    id: 'pixelate', name: 'Pixelate', family: 'Geometry', mark: '[',
    what: 'The cell in big square blocks of flat colour, like a censored face or a mosaic.',
    how: 'The cell is cut into squares. Every pixel in a square shows the average of four looks inside it. A gap slider leaves paper between the tiles.',
    merge: 'Medium. Colours match, so it holds together, but the hard squares say "screen" more than "print".',
    params: [
      { key: 'block', label: 'Block', min: 4, max: 60, step: 1, value: 18 },
      { key: 'gap', label: 'Gap', min: 0, max: 0.3, step: 0.01, value: 0 },
    ],
    glsl: `
  float s = max(2.0, p0 * uK * 1.5);
  vec2 o = (px - uRect.xy) / s;
  vec2 base = uRect.xy + floor(o) * s;
  vec3 c = 0.25 * (photoAt(base + s * vec2(0.25, 0.25)) + photoAt(base + s * vec2(0.75, 0.25)) + photoAt(base + s * vec2(0.25, 0.75)) + photoAt(base + s * vec2(0.75, 0.75)));
  vec2 f = fract(o);
  float e = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
  return mix(uPaper, c, step(p1 * 0.5, e));`,
  },
  {
    id: 'tiles', name: 'Repeat', family: 'Geometry', mark: ';',
    what: 'The cell\'s picture shrunk and repeated in a small grid, like a contact sheet inside the cell.',
    how: 'The cell is split into a few rows and columns. Each small tile maps its own corner-to-corner range onto the whole cell, so it shows a tiny copy. Every other row can shift half a tile, like bricks.',
    merge: 'Echoes the grid of Sequences itself, so it fits the concept, but the small copies are busy next to the label.',
    params: [
      { key: 'count', label: 'Count', min: 2, max: 6, step: 1, value: 3 },
      { key: 'gap', label: 'Gap', min: 0, max: 8, step: 0.5, value: 2 },
      { key: 'brick', label: 'Brick', min: 0, max: 1, step: 1, value: 0 },
    ],
    glsl: `
  vec2 g = cellUV(px) * floor(p0 + 0.5);
  vec2 id = floor(g);
  vec2 f = fract(g);
  if (p2 > 0.5 && mod(id.y, 2.0) > 0.5) f.x = fract(g.x + 0.5);
  vec3 col = photoAt(cellPx(f));
  vec2 e = min(f, 1.0 - f) * uRect.zw / floor(p0 + 0.5);
  return mix(uPaper, col, step(p1 * uK * 0.5, min(e.x, e.y)));`,
  },
  {
    id: 'swirl', name: 'Swirl', family: 'Geometry', mark: '$',
    what: 'The picture twisted around the cell centre, tight in the middle and loose at the edge.',
    how: 'Each pixel turns its lookup around the centre by an angle that is largest at the centre and falls to zero at the rim. Turn on "Breathe" to make the twist ease back and forth.',
    merge: 'Medium. The rim matches the photo, the middle is clearly bent. Feels playful, a little like a filter app.',
    params: [
      { key: 'angle', label: 'Angle', min: -720, max: 720, step: 5, value: 200 },
      { key: 'radius', label: 'Radius', min: 0.2, max: 1.2, step: 0.01, value: 1 },
      { key: 'breathe', label: 'Breathe', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    glsl: `
  vec2 c = cellCenter();
  vec2 d = px - c;
  float R = p1 * 0.5 * max(uRect.z, uRect.w);
  float t = max(0.0, 1.0 - length(d) / R);
  float a = radians(p0) * t * t * (1.0 - p2 + p2 * sin(uTime * 1.5));
  vec2 r = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
  return photoAt(c + r);`,
  },
  {
    id: 'polar', name: 'Polar', family: 'Geometry', mark: '(',
    what: 'The picture wrapped into a circle ("little planet"), or a circle unrolled into a strip.',
    how: 'Each pixel turns its position into an angle and a distance from the centre. In planet mode the angle picks a column of the cell and the distance picks a row. Unroll does the reverse.',
    merge: 'Weak. The result has no relation to the photo around it. Interesting as a one-off, hard to place.',
    params: [
      { key: 'mode', label: 'Unroll', min: 0, max: 1, step: 1, value: 0 },
      { key: 'zoom', label: 'Zoom', min: 0.3, max: 2, step: 0.01, value: 1 },
      { key: 'turn', label: 'Turn', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    glsl: `
  vec2 c = cellCenter();
  float R = 0.5 * min(uRect.z, uRect.w);
  if (p0 < 0.5) {
    vec2 d = px - c;
    float a = atan(d.y, d.x) / (2.0 * PI) + 0.5 + p2;
    float r = length(d) / (R * p1);
    return photoAt(cellPx(vec2(fract(a), clamp(1.0 - r, 0.0, 1.0))));
  }
  vec2 uv = cellUV(px);
  float a = (uv.x + p2) * 2.0 * PI;
  float r = (1.0 - uv.y) * R * p1 * 1.4;
  return photoAt(c + vec2(cos(a), sin(a)) * r);`,
  },

  {
    id: 'crt', name: 'Scanlines', family: 'Signal', mark: '≡',
    what: 'An old TV: dark lines across the picture, a coloured stripe mask and a slightly curved glass.',
    how: 'The cell is bent outward a little like a tube screen. Brightness then dips in a regular wave down the cell to draw the lines, and each pixel column is tinted red, green or blue in turn.',
    merge: 'Medium. It reads as "screen", a different medium from print. Low strength keeps it subtle.',
    params: [
      { key: 'spacing', label: 'Spacing', min: 2, max: 12, step: 0.5, value: 5 },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.55 },
      { key: 'curve', label: 'Curve', min: 0, max: 1, step: 0.01, value: 0.4 },
    ],
    glsl: `
  vec2 uv = cellUV(px) * 2.0 - 1.0;
  vec2 cu = uv * (1.0 + p2 * 0.12 * dot(uv.yx, uv.yx));
  vec2 q = cellPx(cu * 0.5 + 0.5);
  vec3 c = photoAt(q) * 1.08;
  float sp = max(2.0, p0 * uK * 1.5);
  float scan = 0.5 + 0.5 * cos(2.0 * PI * (q.y - uRect.y) / sp);
  c *= 1.0 - p1 * 0.55 * (1.0 - scan);
  float m = mod(floor(px.x * uDensity), 3.0);
  vec3 mask = 0.9 + 0.2 * vec3(step(m, 0.5), step(abs(m - 1.0), 0.5), step(1.5, m));
  c *= mix(vec3(1.0), mask, p1);
  return c * (1.0 - p2 * 0.18 * dot(uv, uv) * 0.5);`,
  },
  {
    id: 'glitch', name: 'Glitch', family: 'Signal', mark: '>',
    what: 'Horizontal bands of the picture jump sideways with colour fringes, like a broken video signal.',
    how: 'The cell is cut into bands. A random roll, re-made a few times a second, picks some bands and slides them left or right. Shifted bands also split red from blue a little.',
    merge: 'Loud and fast. Reads as digital damage. Strong on a beat change, tiring if it never stops.',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 80, step: 1, value: 24 },
      { key: 'band', label: 'Band', min: 4, max: 60, step: 1, value: 14 },
      { key: 'rate', label: 'Rate', min: 0, max: 12, step: 0.5, value: 4 },
      { key: 'split', label: 'Split', min: 0, max: 1, step: 0.01, value: 0.5 },
    ],
    glsl: `
  float bh = max(2.0, p1 * uK * 1.5);
  float band = floor((px.y - uRect.y) / bh);
  float tick = floor(uTime * p2);
  float on = step(0.55, hash(vec2(band, tick)));
  float shift = (hash(vec2(band * 1.3, tick + 7.0)) - 0.5) * 2.0 * p0 * uK * on;
  vec2 q = vec2(px.x + shift, px.y);
  float s = p3 * shift * 0.25;
  return vec3(photoAt(q + vec2(s, 0.0)).r, photoAt(q).g, photoAt(q - vec2(s, 0.0)).b);`,
  },
  {
    id: 'sort', name: 'Pixel sort', family: 'Signal', mark: '¦',
    what: 'Bright parts of the picture drip into streaks, like the "pixel sorting" look.',
    how: 'Each pixel looks back along one direction for a short distance. If it finds a pixel brighter than the level (and brighter than itself), it takes that colour. Bright spots so drag a trail behind them.',
    merge: 'Medium. Streak colours come from the photo, so it blends; the hard streak ends give it away.',
    params: [
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, value: 0.55 },
      { key: 'length', label: 'Length', min: 10, max: 200, step: 1, value: 80 },
      { key: 'dir', label: 'Direction', min: 0, max: 3, step: 1, value: 1 },
    ],
    glsl: `
  vec2 dir = p2 < 0.5 ? vec2(1.0, 0.0) : p2 < 1.5 ? vec2(0.0, 1.0) : p2 < 2.5 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
  float stp = p1 * uK / 24.0;
  vec3 best = photoAt(px);
  float bl = lum(best);
  for (int i = 1; i <= 24; i++) {
    vec2 q = px - dir * float(i) * stp;
    if (q.x < uRect.x || q.y < uRect.y || q.x > uRect.x + uRect.z || q.y > uRect.y + uRect.w) break;
    vec3 c = photoAt(q);
    float l = lum(c);
    if (l > p0 && l > bl) { best = c; bl = l; }
  }
  return best;`,
  },
];
