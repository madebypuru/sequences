// Subject: find the one main subject in an image or video frame.
// Classic script (no module syntax) so the page still runs from file://.
(function () {
  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
  // BiRefNet_lite was the first choice but does not run in Chrome on Apple GPUs: WebGPU
  // needs more than the 10 storage buffers per shader Metal allows, and wasm runs out of
  // memory at its fixed 1024px input. ormbg (IS-Net, Apache-2.0) runs on both.
  // Salient segmentation alone takes the largest salient region, so a small bird in
  // foliage loses to the foliage. Grounding DINO (Apache-2.0) finds the object first;
  // OWL-ViT and OWLv2 fail to build a WebGPU session in onnxruntime-web.
  const MODELS = {
    seg: {
      id: 'onnx-community/ormbg-ONNX',
      cls: 'AutoModel',
      configs: [
        { device: 'webgpu', dtype: 'fp16', needsGpu: true },
        { device: 'wasm', dtype: 'fp16' },
        { device: 'wasm', dtype: 'fp32' },
      ],
    },
    det: {
      id: 'onnx-community/grounding-dino-tiny-ONNX',
      cls: 'AutoModelForZeroShotObjectDetection',
      configs: [
        { device: 'webgpu', dtype: 'fp16', needsGpu: true },
        { device: 'wasm', dtype: 'q8' },
      ],
    },
  };
  // Grounding DINO scores a single generic phrase far more cleanly than a list: on the
  // test clips "an animal" gives birds and the bee 0.77-0.88 and driftwood or a frame-wide
  // flower at most 0.42, while "bird. insect. flower..." scored driftwood as a bird at 0.65.
  const GENERIC_PROMPT = 'an animal. a person.';
  const GENERIC_MIN_SCORE = 0.6;
  const PROMPT_MIN_SCORE = 0.3;
  const MASK_MAX = 256;
  const CLASSIC_MAX = 192;
  const ML_INPUT_MAX = 1024;
  const DET_INPUT_MAX = 800;

  // ---- pixels

  function sourceSize(src) {
    if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
    if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
    return { w: src.width, h: src.height };
  }

  function grab(src, max) {
    const s = sourceSize(src);
    if (!s.w || !s.h) throw new Error('Subject: source has no pixels yet');
    const k = Math.min(1, max / Math.max(s.w, s.h));
    const w = Math.max(1, Math.round(s.w * k));
    const h = Math.max(1, Math.round(s.h * k));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    return { w, h, rgba: g.getImageData(0, 0, w, h).data };
  }

  // ---- classic saliency

  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

  function toLab(rgba, n) {
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = LIN[rgba[i * 4]], g = LIN[rgba[i * 4 + 1]], b = LIN[rgba[i * 4 + 2]];
      const fx = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const fy = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const fz = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      L[i] = 116 * fy - 16;
      A[i] = 500 * (fx - fy);
      B[i] = 200 * (fy - fz);
    }
    return [L, A, B];
  }

  function boxBlur(src, w, h, r) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += src[y * w + x];
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  }

  // Background colours: k-means over the border band, keeping clusters with a real share.
  function borderColours(lab, w, h) {
    const band = Math.max(2, Math.round(0.06 * Math.min(w, h)));
    const pts = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= band && x < w - band && y >= band && y < h - band) continue;
        const i = y * w + x;
        pts.push(lab[0][i], lab[1][i], lab[2][i]);
      }
    }
    const n = pts.length / 3, K = 5;
    const c = [];
    for (let k = 0; k < K; k++) {
      const j = Math.floor(((k + 0.5) / K) * n) * 3;
      c.push([pts[j], pts[j + 1], pts[j + 2]]);
    }
    const lab3 = new Int32Array(n);
    for (let it = 0; it < 8; it++) {
      const sum = c.map(() => [0, 0, 0, 0]);
      for (let p = 0; p < n; p++) {
        let best = 0, bd = Infinity;
        for (let k = 0; k < K; k++) {
          const d = (pts[p * 3] - c[k][0]) ** 2 + (pts[p * 3 + 1] - c[k][1]) ** 2 + (pts[p * 3 + 2] - c[k][2]) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
        lab3[p] = best;
        const s = sum[best];
        s[0] += pts[p * 3]; s[1] += pts[p * 3 + 1]; s[2] += pts[p * 3 + 2]; s[3]++;
      }
      for (let k = 0; k < K; k++) if (sum[k][3]) c[k] = [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]];
    }
    const share = new Array(K).fill(0);
    for (let p = 0; p < n; p++) share[lab3[p]]++;
    return c.filter((_, k) => share[k] / n >= 0.08);
  }

  function normalise(a) {
    const s = Float32Array.from(a).sort();
    const hi = s[Math.floor(s.length * 0.99)] || 1;
    for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] / hi);
    return a;
  }

  function classicMask(src) {
    const { w, h, rgba } = grab(src, CLASSIC_MAX);
    const n = w * h;
    const lab = toLab(rgba, n);
    const bg = borderColours(lab, w, h);

    const colour = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let d = Infinity;
      for (const c of bg) d = Math.min(d, (lab[0][i] - c[0]) ** 2 + (lab[1][i] - c[1]) ** 2 + (lab[2][i] - c[2]) ** 2);
      colour[i] = Math.sqrt(d);
    }

    const rs = Math.max(4, Math.round(0.12 * Math.min(w, h)));
    const near = lab.map((ch) => boxBlur(ch, w, h, 1));
    const far = lab.map((ch) => boxBlur(ch, w, h, rs));
    const contrast = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      contrast[i] = Math.hypot(near[0][i] - far[0][i], near[1][i] - far[1][i], near[2][i] - far[2][i]);
    }

    normalise(colour);
    normalise(contrast);
    const sal = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x / w - 0.5, dy = y / h - 0.5;
        const centre = 0.6 + 0.4 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
        const i = y * w + x;
        sal[i] = (0.65 * colour[i] + 0.35 * contrast[i]) * centre;
      }
    }
    return { w, h, data: normalise(boxBlur(sal, w, h, 1)) };
  }

  function otsu(data) {
    const bins = 64, hist = new Float64Array(bins);
    for (const v of data) hist[Math.min(bins - 1, Math.floor(v * bins))]++;
    let total = 0, sumAll = 0;
    for (let i = 0; i < bins; i++) { total += hist[i]; sumAll += i * hist[i]; }
    let wB = 0, sumB = 0, best = 0, t = bins / 2;
    for (let i = 0; i < bins; i++) {
      wB += hist[i];
      if (!wB || wB === total) continue;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sumAll - sumB) / (total - wB);
      const between = wB * (total - wB) * (mB - mF) ** 2;
      if (between > best) { best = between; t = i + 1; }
    }
    return t / bins;
  }

  // ---- ML models

  const progressListeners = new Set();
  const fileProgress = new Map();
  function report(ev) {
    const key = `${ev.name || ''}/${ev.file}`;
    if (ev.file && ev.total) fileProgress.set(key, { loaded: ev.loaded || 0, total: ev.total });
    if (ev.status === 'done' && fileProgress.has(key)) {
      const f = fileProgress.get(key);
      f.loaded = f.total;
    }
    let loaded = 0, total = 0;
    for (const f of fileProgress.values()) { loaded += f.loaded; total += f.total; }
    const out = { status: ev.status, file: ev.file, error: ev.error, loaded, total, progress: total ? loaded / total : 0 };
    for (const cb of progressListeners) cb(out);
  }

  async function hasGpu() {
    if (!navigator.gpu) return false;
    try { return !!(await navigator.gpu.requestAdapter()); } catch (e) { return false; }
  }

  let lib = null;
  const loading = {}; // model key -> Promise<{ configIndex, model, processor, config }>

  async function loadFrom(key, index) {
    const spec = MODELS[key];
    lib = lib || (await import(TRANSFORMERS_URL));
    const gpu = await hasGpu();
    let lastErr = null;
    for (let i = index; i < spec.configs.length; i++) {
      const config = spec.configs[i];
      if (config.needsGpu && !gpu) continue;
      const name = `${key} ${config.device}/${config.dtype}`;
      report({ status: 'backend', file: name });
      try {
        const [model, processor] = await Promise.all([
          lib[spec.cls].from_pretrained(spec.id, { device: config.device, dtype: config.dtype, progress_callback: report }),
          lib.AutoProcessor.from_pretrained(spec.id, { progress_callback: report }),
        ]);
        return { configIndex: i, model, processor, config };
      } catch (err) {
        report({ status: 'backend-failed', file: name, error: String((err && err.message) || err) });
        lastErr = err;
      }
    }
    throw lastErr || new Error(`Subject: no backend could load ${spec.id}`);
  }

  function loadModel(key, index) {
    if (!loading[key]) {
      loading[key] = loadFrom(key, index || 0).catch((err) => { loading[key] = null; throw err; });
    }
    return loading[key];
  }

  // fp16 can load but fail at run time on some backends; move to the next config and retry.
  async function runModel(key, fn) {
    let state = await loadModel(key);
    for (;;) {
      try {
        return await fn(state);
      } catch (err) {
        report({ status: 'backend-failed', file: `${key} ${state.config.device}/${state.config.dtype}`, error: String((err && err.message) || err) });
        if (state.configIndex + 1 >= MODELS[key].configs.length) throw err;
        state.model.dispose().catch(() => {});
        loading[key] = null;
        state = await loadModel(key, state.configIndex + 1);
      }
    }
  }

  function rawImage(src, max) {
    const { w, h, rgba } = grab(src, max);
    const rgb = new Uint8ClampedArray(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
    return new lib.RawImage(rgb, w, h, 3);
  }

  function halfToFloat(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  // Area-average the square output map back to the source aspect (sigmoid if it is logits).
  function logitsToMask(tensor, srcW, srcH) {
    const [ih, iw] = tensor.dims.slice(-2);
    const raw = tensor.data;
    const value = raw instanceof Uint16Array ? (i) => halfToFloat(raw[i]) : (i) => raw[i];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < raw.length; i += 97) { const v = value(i); if (v < lo) lo = v; if (v > hi) hi = v; }
    const read = lo >= 0 && hi <= 1 ? value : (i) => 1 / (1 + Math.exp(-value(i)));
    const k = Math.min(1, MASK_MAX / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor((y * ih) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * ih) / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor((x * iw) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * iw) / w));
        let s = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += read(yy * iw + xx);
        data[y * w + x] = s / ((x1 - x0) * (y1 - y0));
      }
    }
    return { w, h, data };
  }

  function mlMask(src) {
    return runModel('seg', async (state) => {
      const image = rawImage(src, ML_INPUT_MAX);
      const { pixel_values } = await state.processor(image);
      const input = state.model.sessions.model.inputNames[0];
      const out = await state.model({ [input]: pixel_values });
      return logitsToMask(Object.values(out)[0], image.width, image.height);
    });
  }

  // Grounding DINO wants lowercase phrases each ending in a full stop: "bee. flower."
  function phrases(prompt) {
    const parts = String(prompt || '').toLowerCase().split(/[,.;\n]+/).map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts.join('. ') + '.' : GENERIC_PROMPT;
  }

  // Objects as { label, score, box } in 0..1 frame coordinates, best first.
  function detectObjects(src, prompt) {
    return runModel('det', async (state) => {
      const image = rawImage(src, DET_INPUT_MAX);
      const inputs = await state.processor(image, phrases(prompt));
      const outputs = await state.model(inputs);
      const [res] = state.processor.post_process_grounded_object_detection(outputs, inputs.input_ids, {
        box_threshold: 0.2, text_threshold: 0.2, target_sizes: [[1, 1]],
      });
      return res.boxes
        .map((b, i) => {
          const x0 = clamp01(b[0]), y0 = clamp01(b[1]), x1 = clamp01(b[2]), y1 = clamp01(b[3]);
          return { label: res.labels[i], score: res.scores[i], box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
        })
        .filter((d) => d.box.w > 0 && d.box.h > 0)
        .sort((a, b) => b.score - a.score);
    });
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // Score first; centrality only breaks near-ties between real objects. A box over half
  // the frame is a scene, not a discrete object (a prompt of "bee" on a frame-filling
  // flower scored 0.33), and the salient path frames scenes better.
  function pickObject(objects, minScore) {
    let best = null, bestRank = -Infinity;
    for (const o of objects) {
      if (o.score < minScore || o.box.w * o.box.h > 0.5) continue;
      const cx = o.box.x + o.box.w / 2 - 0.5, cy = o.box.y + o.box.h / 2 - 0.5;
      const rank = o.score * (0.92 + 0.08 * (1 - Math.hypot(cx, cy) / Math.SQRT1_2));
      if (rank > bestRank) { best = o; bestRank = rank; }
    }
    return best;
  }

  function cropCanvas(src, r) {
    const s = sourceSize(src);
    const sx = Math.round(r.x * s.w), sy = Math.round(r.y * s.h);
    const sw = Math.max(1, Math.round(r.w * s.w)), sh = Math.max(1, Math.round(r.h * s.h));
    const k = Math.min(1, ML_INPUT_MAX / Math.max(sw, sh));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sw * k));
    cv.height = Math.max(1, Math.round(sh * k));
    cv.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv;
  }

  function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy, union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  const inset = (b, f) => ({ x: b.x + b.w * f, y: b.y + b.h * f, w: b.w * (1 - 2 * f), h: b.h * (1 - 2 * f) });

  // The detector box is the box: segmentation dropped a bee's dark abdomen against a dark
  // background where Grounding DINO kept it. Segmentation places the core: the padded
  // crop gives the segmenter context, and reading the mask only inside the detector box
  // keeps leaves or a perch joined to the subject out. When segmentation fails or covers
  // too little of the box, the core is the box's middle.
  async function refineObject(src, obj) {
    const d = obj.box;
    const pad = 0.35 * Math.max(d.w, d.h);
    const x0 = clamp01(d.x - pad), y0 = clamp01(d.y - pad);
    const crop = { x: x0, y: y0, w: clamp01(d.x + d.w + pad) - x0, h: clamp01(d.y + d.h + pad) - y0 };
    const fromDetector = { box: d, core: inset(d, 0.2), mask: null, maskBox: crop };
    try {
      fromDetector.mask = await mlMask(cropCanvas(src, crop));
    } catch (err) {
      return fromDetector;
    }
    const mask = fromDetector.mask;
    const t = otsu(mask.data);
    const found = locate(cutMask(mask, { x: (d.x - crop.x) / crop.w, y: (d.y - crop.y) / crop.h, w: d.w / crop.w, h: d.h / crop.h }), () => t);
    const toFrame = (r) => ({ x: d.x + r.x * d.w, y: d.y + r.y * d.h, w: r.w * d.w, h: r.h * d.h });
    if (found === FALLBACK || iou(toFrame(found.box), d) < 0.4) return fromDetector;
    return { box: d, core: toFrame(found.core), mask, maskBox: crop };
  }

  function cutMask(mask, r) {
    const x0 = Math.floor(r.x * mask.w), y0 = Math.floor(r.y * mask.h);
    const w = Math.max(1, Math.min(mask.w, Math.ceil((r.x + r.w) * mask.w)) - x0);
    const h = Math.max(1, Math.min(mask.h, Math.ceil((r.y + r.h) * mask.h)) - y0);
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) data.set(mask.data.subarray((y0 + y) * mask.w + x0, (y0 + y) * mask.w + x0 + w), y * w);
    return { w, h, data };
  }

  // ---- mask -> box and core

  function components(bin, w, h) {
    const label = new Int32Array(w * h).fill(-1);
    const comps = [];
    const stack = [];
    for (let s = 0; s < w * h; s++) {
      if (!bin[s] || label[s] >= 0) continue;
      const id = comps.length;
      const c = { id, area: 0, x0: w, y0: h, x1: 0, y1: 0 };
      label[s] = id;
      stack.push(s);
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p - x) / w;
        c.area++;
        if (x < c.x0) c.x0 = x;
        if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y;
        if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (bin[q] && label[q] < 0) { label[q] = id; stack.push(q); }
          }
        }
      }
      comps.push(c);
    }
    return { label, comps };
  }

  function morph(bin, w, h, keep) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(w - 1, Math.max(0, x + dx)), ny = Math.min(h - 1, Math.max(0, y + dy));
            n += bin[ny * w + nx];
          }
        }
        out[y * w + x] = keep(n) ? 1 : 0;
      }
    }
    return out;
  }
  const erode = (b, w, h) => morph(b, w, h, (n) => n === 9);
  const dilate = (b, w, h) => morph(b, w, h, (n) => n > 0);

  // Largest rectangle inside the box that is mostly subject, preferring dense parts.
  function findCore(sub, w, h, c) {
    const I = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += sub[y * w + x];
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
      }
    }
    const sum = (x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    const bx0 = c.x0, by0 = c.y0, bw = c.x1 + 1 - c.x0, bh = c.y1 + 1 - c.y0;
    const boxArea = bw * bh;
    const N = 20;
    const xs = [], ys = [];
    for (let i = 0; i <= N; i++) { xs.push(bx0 + Math.round((i * bw) / N)); ys.push(by0 + Math.round((i * bh) / N)); }
    let best = null, fallback = null;
    for (let a = 0; a < N; a++) for (let b = a + 1; b <= N; b++) {
      const x0 = xs[a], x1 = xs[b];
      if (x1 <= x0) continue;
      for (let p = 0; p < N; p++) for (let q = p + 1; q <= N; q++) {
        const y0 = ys[p], y1 = ys[q];
        if (y1 <= y0) continue;
        const rw = x1 - x0, rh = y1 - y0, area = rw * rh;
        if (area < 0.25 * boxArea || rw > 2.5 * rh || rh > 2.5 * rw) continue;
        const cov = sum(x0, y0, x1, y1) / area;
        if (!fallback || cov > fallback.cov) fallback = { x0, y0, x1, y1, cov };
        if (cov < 0.6) continue;
        const score = area * cov * cov;
        if (!best || score > best.score) best = { x0, y0, x1, y1, cov, score };
      }
    }
    return best || fallback || { x0: bx0, y0: by0, x1: c.x1 + 1, y1: c.y1 + 1 };
  }

  const FALLBACK = { box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, core: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 } };

  function locate(mask, threshold) {
    const { w, h, data } = mask;
    const t = threshold(data);
    let bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bin[i] = data[i] >= t ? 1 : 0;
    bin = erode(dilate(dilate(erode(bin, w, h), w, h), w, h), w, h);
    const { label, comps } = components(bin, w, h);
    const minArea = 0.002 * w * h;
    let main = null;
    for (const c of comps) if (c.area >= minArea && (!main || c.area > main.area)) main = c;
    if (!main) return FALLBACK;
    const sub = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) sub[i] = label[i] === main.id ? 1 : 0;
    const core = findCore(sub, w, h, main);
    return {
      box: { x: main.x0 / w, y: main.y0 / h, w: (main.x1 + 1 - main.x0) / w, h: (main.y1 + 1 - main.y0) / h },
      core: { x: core.x0 / w, y: core.y0 / h, w: (core.x1 - core.x0) / w, h: (core.y1 - core.y0) / h },
    };
  }

  // ---- public

  const BACKENDS = {
    classic: { mask: async (src) => classicMask(src), threshold: otsu },
    ml: { mask: mlMask, threshold: otsu },
  };

  // Once a model has failed under 'auto' (offline, no backend runs), skip it for the
  // session instead of refetching on every frame.
  let autoNoObject = false;
  let autoFellBack = false;
  const WHOLE = { x: 0, y: 0, w: 1, h: 1 };

  async function salient(source, method) {
    let used = method === 'auto' ? (autoFellBack ? 'classic' : 'ml') : method;
    let mask;
    try {
      mask = await BACKENDS[used].mask(source);
    } catch (err) {
      if (method !== 'auto' || used === 'classic') throw err;
      autoFellBack = true;
      used = 'classic';
      mask = await BACKENDS.classic.mask(source);
    }
    const found = locate(mask, BACKENDS[used].threshold);
    return { box: found.box, core: found.core, mask, maskBox: WHOLE, method: used, label: null, score: null };
  }

  // method: 'auto' (object, then salient ML, then classic), 'object' (object, then
  // salient ML), 'ml' or 'classic'. prompt names the subject ("bee"); empty means any
  // animal or person, and a frame with none (a waterfall) falls to the salient path.
  // mask covers maskBox, which is the whole frame except for 'object' (the padded crop).
  async function detect(source, opts) {
    const method = (opts && opts.method) || 'auto';
    const prompt = ((opts && opts.prompt) || '').trim();
    const t0 = performance.now();
    let r = null;
    if (method === 'object' || (method === 'auto' && !autoNoObject)) {
      try {
        const obj = pickObject(await detectObjects(source, prompt), prompt ? PROMPT_MIN_SCORE : GENERIC_MIN_SCORE);
        if (obj) {
          const crop = await refineObject(source, obj);
          r = { box: crop.box, core: crop.core, mask: crop.mask, maskBox: crop.maskBox, method: 'object', label: obj.label, score: obj.score };
        }
      } catch (err) {
        if (method === 'object') throw err;
        autoNoObject = true;
      }
    }
    if (!r) r = await salient(source, method === 'object' ? 'ml' : method);
    r.ms = performance.now() - t0;
    return r;
  }

  // Video: each detection becomes a keyframe that takes effect `delay` seconds after its
  // frame, so an async detection that lands within that budget never rewrites the past.
  // at(t) runs a critically damped spring on the eight rect edges toward the latest
  // effective keyframe, stepped at a fixed rate from the first one, so the result is a
  // pure function of the keyframes and t. A detection whose box barely overlaps the
  // keyframe nearest in time is held back until the next detection agrees with it, so
  // one bad frame cannot yank the box while a subject that really moves gets through.
  const OUTLIER_IOU = 0.1;
  const EDGES = (r) => [r.box.x, r.box.y, r.box.x + r.box.w, r.box.y + r.box.h, r.core.x, r.core.y, r.core.x + r.core.w, r.core.y + r.core.h];

  function tracker(opts) {
    const method = (opts && opts.method) || 'auto';
    const prompt = (opts && opts.prompt) || '';
    const omega = (opts && opts.omega) || 10;
    const delay = opts && opts.delay != null ? opts.delay : 0.2;
    const covered = (opts && opts.covered) || 0.2;
    const DT = 1 / 120;
    const keys = []; // sorted by t: { frame, t, e }
    let busy = false;
    let sim = null; // { step, pos, vel }
    let held = null; // box of a rejected detection awaiting a second opinion

    function target(t) {
      let i = 0;
      while (i + 1 < keys.length && keys[i + 1].t <= t) i++;
      return keys[i].e;
    }

    function advance(state, t) {
      const t0 = keys[0].t;
      while (t0 + (state.step + 1) * DT <= t) {
        state.step++;
        const goal = target(t0 + state.step * DT);
        for (let j = 0; j < 8; j++) {
          const acc = omega * omega * (goal[j] - state.pos[j]) - 2 * omega * state.vel[j];
          state.vel[j] += acc * DT;
          state.pos[j] += state.vel[j] * DT;
        }
      }
      return state;
    }

    function toRects(e) {
      const bx0 = e[0], by0 = e[1], bx1 = Math.max(e[2], bx0), by1 = Math.max(e[3], by0);
      const cx0 = Math.min(Math.max(e[4], bx0), bx1), cy0 = Math.min(Math.max(e[5], by0), by1);
      const cx1 = Math.min(Math.max(e[6], cx0), bx1), cy1 = Math.min(Math.max(e[7], cy0), by1);
      return {
        box: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 },
        core: { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 },
      };
    }

    return {
      async update(source, timeSec) {
        if (busy) return;
        if (keys.some((k) => Math.abs(k.frame - timeSec) < covered)) return;
        busy = true;
        try {
          const r = await detect(source, { method, prompt });
          if (keys.length) {
            const near = keys.reduce((a, k) => (Math.abs(k.frame - timeSec) < Math.abs(a.frame - timeSec) ? k : a));
            if (iou(r.box, near.box) < OUTLIER_IOU && !(held && iou(r.box, held) >= OUTLIER_IOU)) {
              held = r.box;
              return;
            }
          }
          held = null;
          const key = { frame: timeSec, t: timeSec + delay, e: EDGES(r), box: r.box };
          let i = keys.findIndex((k) => k.t > key.t);
          if (i < 0) i = keys.length;
          keys.splice(i, 0, key);
          if (sim && (i === 0 || keys[0].t + sim.step * DT >= key.t)) sim = null;
        } finally {
          busy = false;
        }
      },
      at(timeSec) {
        if (!keys.length) return FALLBACK;
        const t0 = keys[0].t;
        if (!sim || t0 + sim.step * DT > timeSec) sim = { step: 0, pos: keys[0].e.slice(), vel: new Array(8).fill(0) };
        return toRects(advance(sim, timeSec).pos);
      },
      get keyframes() { return keys.length; },
    };
  }

  window.Subject = {
    detect,
    tracker,
    load: () => Promise.all([loadModel('det'), loadModel('seg')]).then(([det, seg]) => ({ det: det.config, seg: seg.config })),
    onProgress(cb) {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
  };
})();
