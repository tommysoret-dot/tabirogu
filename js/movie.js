/* TABIROGU — 思い出ムービー: canvas slideshow + generated music-box BGM, recorded with MediaRecorder */
(function () {
  const { Store, URLS, Geo } = TB;
  const W = 720, H = 1280, FPS = 30;
  const C = { paper: '#ebe3d2', paper2: '#f6f1e6', ink: '#22304a', soft: '#5d6577', stamp: '#c2452d', tape: 'rgba(226,184,75,.8)', tape2: 'rgba(155,179,154,.85)', polaroid: '#fbf9f4' };
  const HAND = '"Klee One", "Hiragino Maru Gothic ProN", sans-serif', BODY = '"Zen Kaku Gothic New", "Hiragino Sans", sans-serif', MONO = '"Courier Prime", "Courier New", monospace';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ease = u => u < 0 ? 0 : u > 1 ? 1 : 1 - Math.pow(1 - u, 3);
  const clamp = (u) => Math.max(0, Math.min(1, u));
  const fmtD = ts => { const d = new Date(ts); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

  function pickMime() {
    const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    if (!window.MediaRecorder) return null;
    return list.find(m => MediaRecorder.isTypeSupported(m)) || '';
  }
  const supported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);

  /* ---------- plans: what goes in the movie ---------- */
  function memoryPhotos() {
    const done = new Set(Store.trips.filter(t => t.status === 'done').map(t => t.id));
    return Store.photos.filter(p => p.kind !== 'guide' && done.has(p.tripId) && p.place);
  }
  function spread(list, n) {
    if (list.length <= n) return list;
    const out = []; for (let i = 0; i < n; i++) out.push(list[Math.round(i * (list.length - 1) / (n - 1 || 1))]);
    return [...new Set(out)];
  }
  function regionPlan(regionId, perPlace) {
    let r = Geo.JP_REGIONS.find(x => x.id === regionId), kind = 'jp', keys, features;
    if (r) { keys = r.prefs.map(id => 'jp:' + id); features = Geo.jp.features.filter(f => r.prefs.includes(f.properties.id)); }
    else {
      r = Geo.worldRegions.find(x => x.id === regionId); kind = 'world';
      if (!r) return null;
      keys = r.members.map(c => 'w:' + c); features = Geo.world.features.filter(f => f.properties.r === regionId);
    }
    const all = memoryPhotos();
    const calc = TB.UI.calc();
    const places = keys.map(k => {
      const ph = all.filter(p => p.place === k || (k === 'w:JP' && p.place.startsWith('jp:'))).sort((a, b) => a.takenAt - b.takenAt);
      const cover = Store.settings.covers[k] && ph.find(p => p.id === Store.settings.covers[k]);
      const pick = spread(ph, perPlace);
      if (cover && !pick.includes(cover)) pick[0] = cover;
      const tripIds = [...(calc.visited.get(k) || [])];
      const first = Store.trips.filter(t => tripIds.includes(t.id)).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))[0];
      return { key: k, name: Geo.placeName(k), photos: pick.sort((a, b) => a.takenAt - b.takenAt), cover: (cover || ph[0] || {}).id, visited: calc.visited.has(k), trip: first };
    }).sort((a, b) => ((a.photos[0] || {}).takenAt || 9e15) - ((b.photos[0] || {}).takenAt || 9e15));
    const ts = places.flatMap(p => p.photos.map(x => x.takenAt));
    const name = kind === 'jp' ? r.name + '地方' : r.name;
    const reg = [...calc.jpRegions, ...calc.worldRegions].find(x => x.id === regionId) || {};
    return { kind: 'region', mapKind: kind, id: regionId, title: name, stampText: '制覇', places, features, keyOf: f => f.key,
      span: ts.length ? `${fmtD(Math.min(...ts))} — ${fmtD(Math.max(...ts))}` : '', bonus: reg.bonus || 0, done: !!reg.done, total: keys.length };
  }
  function tripPlan(tripId, maxPhotos) {
    const t = Store.trips.find(x => x.id === tripId); if (!t) return null;
    const spots = (t.guide && t.guide.spots) || [];
    const ph = Store.photos.filter(p => p.tripId === tripId && p.kind !== 'guide').sort((a, b) => a.takenAt - b.takenAt);
    const pick = spread(ph, maxPhotos);
    const keys = [...new Set([...(t.places || []), ...pick.map(p => p.place).filter(Boolean)])];
    const features = keys.map(k => Geo.feature(k)).filter(Boolean);
    const places = keys.map(k => ({ key: k, name: Geo.placeName(k), photos: pick.filter(p => p.place === k), cover: (pick.find(p => p.place === k) || {}).id, visited: true, trip: t }));
    const loose = pick.filter(p => !p.place);
    if (loose.length) places.push({ key: '', name: '', photos: loose, visited: true, trip: t });
    const fmt = s => s ? s.replace(/-/g, '.') : '';
    return { kind: 'trip', mapKind: keys.every(k => k.startsWith('jp:')) ? 'jp' : 'world', id: tripId, title: t.title || '旅の記録', stampText: '旅の記録', places, features: keys.length > 1 ? features : [],
      span: t.startDate ? `${fmt(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ' — ' + fmt(t.endDate) : ''}` : '', spotName: id => (spots.find(s => s.id === id) || {}).name || '', total: keys.length, bonus: 0, done: true, trip: t };
  }

  /* ---------- scenes ---------- */
  function buildScenes(plan, opts) {
    const per = opts.length === 'short' ? 1.9 : 2.6;
    const sc = [{ type: 'title', dur: 3.2 }];
    if (plan.features.length > 1) sc.push({ type: 'map', dur: Math.min(7, 1.4 + plan.places.length * .55) });
    plan.places.forEach((pl, pi) => pl.photos.forEach((p, i) => sc.push({ type: 'photo', dur: per, photo: p, place: pl, chapter: pi + 1, first: i === 0, kb: kenBurns(p.id) })));
    sc.push({ type: 'end', dur: 3.6 });
    let t = 0; sc.forEach(s => { s.start = t; t += s.dur; });
    return { scenes: sc, total: t };
  }
  function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }
  function kenBurns(id) {
    const a = hash(id), b = hash(id + 'x'), zoomIn = a > .4;
    return { s0: zoomIn ? 1.04 : 1.2, s1: zoomIn ? 1.2 : 1.04, x0: (b - .5) * .12, y0: (a - .5) * .1, x1: (a - .5) * -.1, y1: (b - .5) * -.08, rot: (a - .5) * 4 };
  }

  /* ---------- image loading (lazy, limited memory) ---------- */
  function makeLoader() {
    const m = new Map();
    const load = async (id, kind) => {
      const k = id + ':' + kind; if (m.has(k)) return m.get(k);
      const p = (async () => {
        const b = await Store.getBlob(id); if (!b) return null;
        const blob = b[kind] || b.full;
        try { return await createImageBitmap(blob); }
        catch (e) { const u = URL.createObjectURL(blob); const img = new Image(); img.src = u; await img.decode(); return img; }
      })();
      m.set(k, p); p.then(v => { m.set(k, Promise.resolve(v)); m.get(k).v = v; });
      return p;
    };
    const get = (id, kind) => { const p = m.get(id + ':' + kind); return p && p.v; };
    const drop = (id, kind) => { const p = m.get(id + ':' + kind); if (p && p.v && p.v.close) p.v.close(); m.delete(id + ':' + kind); };
    const dropAll = () => [...m.keys()].forEach(k => { const [id, kind] = k.split(':'); drop(id, kind); });
    return { load, get, drop, dropAll };
  }

  /* ---------- drawing ---------- */
  let grain = null;
  function paper(ctx) {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    if (!grain) {
      grain = document.createElement('canvas'); grain.width = 256; grain.height = 256;
      const g = grain.getContext('2d'), d = g.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 14; }
      g.putImageData(d, 0, 0);
    }
    ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.fillRect(0, 0, W, H);
  }
  function cover(ctx, img, x, y, w, h, s = 1, ox = 0, oy = 0) {
    const r = Math.max(w / img.width, h / img.height) * s;
    const iw = img.width * r, ih = img.height * r;
    ctx.drawImage(img, x + (w - iw) / 2 + ox * w, y + (h - ih) / 2 + oy * h, iw, ih);
  }
  function stamp(ctx, x, y, r, text, u, rot = -.2) {
    const k = ease(u); if (k <= 0) return;
    const sc = 1 + (1 - k) * 1.4;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot - (1 - k) * .5); ctx.scale(sc, sc); ctx.globalAlpha *= Math.min(1, k * 1.4) * .92;
    ctx.strokeStyle = C.stamp; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r - 12, 0, 7); ctx.stroke();
    ctx.fillStyle = C.stamp; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = text.split('\n'); const fs = Math.min(r * .62, (r * 1.5) / Math.max(...lines.map(l => l.length)));
    ctx.font = `600 ${fs}px ${HAND}`;
    lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * fs * 1.1));
    ctx.restore();
  }
  function tape(ctx, x, y, w, rot, color) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color; ctx.fillRect(-w / 2, -16, w, 32); ctx.restore(); }
  function textFit(ctx, s, max, font) { let size = parseInt(font); ctx.font = font; while (ctx.measureText(s).width > max && size > 18) { size -= 2; ctx.font = font.replace(/\d+px/, size + 'px'); } }

  function drawTitle(ctx, plan, u, book) {
    paper(ctx);
    ctx.save(); ctx.globalAlpha = ease(u * 2);
    ctx.fillStyle = C.ink; ctx.textAlign = 'center';
    ctx.font = `700 26px ${MONO}`; ctx.fillText('T A B I R O G U', W / 2, 160);
    ctx.font = `28px ${HAND}`; ctx.fillStyle = C.soft; ctx.fillText(book, W / 2, 206);
    tape(ctx, W / 2 - 150, 330, 170, -.08, C.tape);
    ctx.fillStyle = C.ink; textFit(ctx, plan.title, W - 120, `600 92px ${HAND}`); ctx.fillText(plan.title, W / 2, 470);
    ctx.font = `30px ${MONO}`; ctx.fillStyle = C.soft; ctx.fillText(plan.span, W / 2, 540);
    ctx.restore();
    stamp(ctx, W / 2, 830, 150, plan.stampText.length > 3 ? plan.stampText.replace(/(.{2})/, '$1\n') : plan.stampText, (u * 3.2 - 1.1) / .6);
    ctx.globalAlpha = 1;
  }
  function projFor(plan, box) {
    const fc = { type: 'FeatureCollection', features: plan.features };
    const lons = plan.features.map(f => d3.geoCentroid(f)[0] * Math.PI / 180);
    const lon = Math.atan2(lons.reduce((s, x) => s + Math.sin(x), 0), lons.reduce((s, x) => s + Math.cos(x), 0)) * 180 / Math.PI;
    return d3.geoMercator().rotate([-lon, 0]).fitExtent(box, fc);
  }
  function drawMap(ctx, plan, u, L, dur) {
    paper(ctx);
    const proj = plan._proj || (plan._proj = projFor(plan, [[50, 280], [W - 50, H - 300]]));
    const path = d3.geoPath(proj, ctx);
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.font = `600 54px ${HAND}`; ctx.fillText(plan.title, W / 2, 170);
    const order = plan.places.filter(p => p.visited);
    const step = Math.max(.25, (dur - 1.6) / Math.max(1, order.length));
    const tSec = u * dur;
    ctx.lineJoin = 'round';
    plan.features.forEach(f => { ctx.beginPath(); path(f); ctx.fillStyle = C.paper2; ctx.fill(); ctx.strokeStyle = 'rgba(34,48,74,.55)'; ctx.lineWidth = 1.5; ctx.stroke(); });
    let shown = 0;
    order.forEach((pl, i) => {
      const k = clamp((tSec - .5 - i * step) / .5); if (k <= 0) return;
      shown++;
      const f = plan.features.find(x => x.key === pl.key); if (!f) return;
      const img = pl.cover && L.get(pl.cover, 'thumb');
      ctx.save(); ctx.beginPath(); path(f); ctx.clip(); ctx.globalAlpha = k;
      if (img) { const [[x0, y0], [x1, y1]] = path.bounds(f); cover(ctx, img, x0, y0, x1 - x0, y1 - y0, 1.05 + (1 - k) * .4); }
      else { ctx.fillStyle = C.tape; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
      ctx.beginPath(); path(f); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.stroke();
      if (k > 0 && k < 1) { const [cx, cy] = path.centroid(f); ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = C.stamp; ctx.beginPath(); ctx.arc(cx, cy, 10 + 50 * k, 0, 7); ctx.fill(); ctx.restore(); }
    });
    ctx.fillStyle = C.ink; ctx.font = `700 60px ${MONO}`; ctx.fillText(`${shown} / ${plan.total}`, W / 2, H - 170);
    ctx.font = `28px ${HAND}`; ctx.fillStyle = C.soft;
    ctx.fillText(plan.kind === 'region' ? (plan.mapKind === 'jp' ? '都道府県' : 'の国') : 'の場所', W / 2, H - 120);
  }
  function drawPhoto(ctx, sc, u, L, plan) {
    const p = sc.photo, img = L.get(p.id, 'full') || L.get(p.id, 'thumb');
    const kb = sc.kb, k = u;
    // background: same photo, blurred & tinted
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
    if (img) {
      ctx.save();
      if ('filter' in ctx) ctx.filter = 'blur(26px) saturate(1.1)';
      cover(ctx, img, -40, -40, W + 80, H + 80, 1.1);
      ctx.restore();
      ctx.fillStyle = 'rgba(20,24,34,.38)'; ctx.fillRect(0, 0, W, H);
    }
    // polaroid
    const pw = 600, ph = 600, px = (W - pw) / 2, py = 250;
    ctx.save(); ctx.translate(W / 2, py + 380); ctx.rotate(kb.rot * Math.PI / 180); ctx.translate(-W / 2, -(py + 380));
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.fillStyle = C.polaroid; ctx.fillRect(px - 22, py - 22, pw + 44, ph + 190);
    ctx.shadowColor = 'transparent';
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    if (img) cover(ctx, img, px, py, pw, ph, kb.s0 + (kb.s1 - kb.s0) * k, kb.x0 + (kb.x1 - kb.x0) * k, kb.y0 + (kb.y1 - kb.y0) * k);
    else { ctx.fillStyle = '#ccc'; ctx.fillRect(px, py, pw, ph); }
    ctx.restore();
    const cap = p.caption || (plan.spotName && plan.spotName(p.spotId)) || sc.place.name || '';
    ctx.fillStyle = '#333'; ctx.textAlign = 'center';
    textFit(ctx, cap, pw - 20, `600 44px ${HAND}`); ctx.fillText(cap, W / 2, py + ph + 78);
    ctx.font = `24px ${MONO}`; ctx.fillStyle = '#777'; ctx.fillText(fmtD(p.takenAt), W / 2, py + ph + 128);
    ctx.restore();
    tape(ctx, px + 40, py - 18, 150, -.35, C.tape);
    tape(ctx, px + pw - 40, py - 18, 150, .3, C.tape2);
    // chapter label
    if (sc.place.name) {
      const a = sc.first ? ease(u * 3) : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = C.paper2;
      ctx.font = `700 22px ${MONO}`; ctx.textAlign = 'left';
      ctx.fillText(`CHAPTER ${String(sc.chapter).padStart(2, '0')}`, 60, 130);
      textFit(ctx, sc.place.name, W - 120, `600 64px ${HAND}`); ctx.fillText(sc.place.name, 60, 200);
      ctx.restore();
    }
    if (sc.place.trip && sc.place.trip.title) {
      ctx.fillStyle = 'rgba(246,241,230,.85)'; ctx.font = `26px ${BODY}`; ctx.textAlign = 'center';
      ctx.fillText(sc.place.trip.title, W / 2, H - 150);
    }
  }
  function drawEnd(ctx, plan, u, book) {
    paper(ctx);
    ctx.textAlign = 'center';
    if (plan.kind === 'region') {
      stamp(ctx, W / 2, 470, 190, plan.done ? `${plan.title.length > 5 ? '地方' : plan.title}\n制覇` : 'つづく', u * 2.2);
      ctx.globalAlpha = ease((u - .35) * 3);
      ctx.fillStyle = C.ink; ctx.font = `700 64px ${MONO}`; ctx.fillText(plan.done ? `+${plan.bonus}pt` : '', W / 2, 800);
      ctx.font = `30px ${HAND}`; ctx.fillStyle = C.soft; ctx.fillText(plan.done ? '制覇ボーナス' : '', W / 2, 850);
    } else {
      stamp(ctx, W / 2, 500, 170, 'また\n行こう', u * 2.2);
      ctx.globalAlpha = ease((u - .35) * 3);
    }
    ctx.fillStyle = C.ink; ctx.font = `700 26px ${MONO}`; ctx.fillText('T A B I R O G U', W / 2, H - 200);
    ctx.font = `28px ${HAND}`; ctx.fillStyle = C.soft; ctx.fillText(book, W / 2, H - 155);
    ctx.globalAlpha = 1;
    if (u > .82) { ctx.fillStyle = `rgba(235,227,210,${(u - .82) / .18})`; ctx.fillRect(0, 0, W, H); }
  }
  function drawScene(ctx, sc, local, L, plan, book) {
    const u = clamp(local / sc.dur);
    if (sc.type === 'title') drawTitle(ctx, plan, u, book);
    else if (sc.type === 'map') drawMap(ctx, plan, u, L, sc.dur);
    else if (sc.type === 'photo') drawPhoto(ctx, sc, u, L, plan);
    else drawEnd(ctx, plan, u, book);
  }
  const FADE = .55;
  function drawAt(ctx, tl, t, L, plan, book) {
    const sc = tl.scenes; let i = sc.findIndex(s => t < s.start + s.dur); if (i < 0) i = sc.length - 1;
    const s = sc[i], local = t - s.start;
    ctx.globalAlpha = 1;
    if (i > 0 && local < FADE) {
      drawScene(ctx, sc[i - 1], sc[i - 1].dur, L, plan, book);
      ctx.save(); ctx.globalAlpha = local / FADE; drawScene(ctx, s, local, L, plan, book); ctx.restore();
    } else drawScene(ctx, s, local, L, plan, book);
    return i;
  }

  /* ---------- music box BGM (generated, no copyright) ---------- */
  function musicBox(ac, out, t0, dur) {
    const bpm = 84, beat = 60 / bpm, bar = beat * 4;
    const prog = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62], [53, 57, 60], [55, 59, 62]];
    const pats = [[0, 1, 2, 3, 2, 1, 0, 1], [0, 2, 3, 1, 2, 3, 4, 3], [3, 2, 1, 0, 1, 2, 3, 4]];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const master = ac.createGain();
    master.gain.setValueAtTime(0, t0); master.gain.linearRampToValueAtTime(.55, t0 + 1.2);
    master.gain.setValueAtTime(.55, t0 + Math.max(1.3, dur - 2.5)); master.gain.linearRampToValueAtTime(0, t0 + dur);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    master.connect(lp); lp.connect(out);
    const bell = (m, at, vel, len = 1.6) => {
      [[1, 1], [2.01, .28], [3.98, .08]].forEach(([mul, g]) => {
        const o = ac.createOscillator(), e = ac.createGain();
        o.type = 'sine'; o.frequency.value = hz(m) * mul;
        e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(vel * g, at + .006); e.gain.exponentialRampToValueAtTime(.0001, at + len / mul);
        o.connect(e); e.connect(master); o.start(at); o.stop(at + len / mul + .05);
      });
    };
    const pad = (ch, at) => ch.forEach(m => {
      const o = ac.createOscillator(), e = ac.createGain();
      o.type = 'triangle'; o.frequency.value = hz(m - 12);
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(.035, at + .4); e.gain.linearRampToValueAtTime(0, at + bar);
      o.connect(e); e.connect(master); o.start(at); o.stop(at + bar + .05);
    });
    for (let b = 0; b * bar < dur; b++) {
      const at = t0 + b * bar, ch = prog[b % prog.length], pat = pats[Math.floor(b / 4) % pats.length];
      const tones = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12];
      pad(ch, at);
      pat.forEach((ix, k) => bell(tones[ix] + 12, at + k * beat / 2, k % 4 === 0 ? .18 : .12));
      if (b % 2 === 1) bell(ch[2] + 24, at + beat * 3.5, .07, 2.4);
    }
  }

  /* ---------- record ---------- */
  async function record(plan, opts, canvas, onProgress, signal) {
    try { await Promise.all([document.fonts.load(`600 40px "Klee One"`), document.fonts.load(`700 20px "Courier Prime"`), document.fonts.load(`20px "Zen Kaku Gothic New"`)]); } catch (e) { }
    const tl = buildScenes(plan, opts);
    const L = makeLoader();
    const book = Store.settings.bookName || '';
    await Promise.all(plan.places.map(p => p.cover && L.load(p.cover, 'thumb')));
    const photoScenes = tl.scenes.filter(s => s.type === 'photo');
    await Promise.all(photoScenes.slice(0, 2).map(s => L.load(s.photo.id, 'full')));
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    drawAt(ctx, tl, 0, L, plan, book);
    const mime = pickMime();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC(); await ac.resume();
    const dest = ac.createMediaStreamDestination(); const out = ac.createGain(); out.connect(dest);
    if (opts.listen !== false) out.connect(ac.destination);
    const t0 = ac.currentTime + .15;
    if (opts.bgm === 'box') musicBox(ac, out, t0, tl.total);
    else if (opts.bgm === 'file' && opts.bgmFile) {
      const buf = await ac.decodeAudioData(await opts.bgmFile.arrayBuffer());
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ac.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.9, t0 + 1); g.gain.setValueAtTime(.9, t0 + tl.total - 2.5); g.gain.linearRampToValueAtTime(0, t0 + tl.total);
      src.connect(g); g.connect(out); src.start(t0); src.stop(t0 + tl.total + .1);
    }
    const vs = canvas.captureStream(FPS);
    const stream = new MediaStream([...vs.getVideoTracks(), ...(opts.bgm === 'none' ? [] : dest.stream.getAudioTracks())]);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : { videoBitsPerSecond: 6e6 });
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => rec.onstop = r);
    let wake = null; try { wake = await navigator.wakeLock.request('screen'); } catch (e) { }
    await new Promise(r => setTimeout(r, Math.max(0, (t0 - ac.currentTime) * 1000)));
    rec.start(500);
    const start = performance.now();
    let last = -1;
    await new Promise(resolve => {
      const frame = () => {
        if (signal && signal.aborted) return resolve();
        const t = (performance.now() - start) / 1000;
        const i = drawAt(ctx, tl, Math.min(t, tl.total - .001), L, plan, book);
        if (i !== last) { // prefetch next photos, free old ones
          last = i;
          tl.scenes.slice(i + 1, i + 3).forEach(s => s.type === 'photo' && L.load(s.photo.id, 'full'));
          tl.scenes.slice(0, Math.max(0, i - 1)).forEach(s => s.type === 'photo' && L.drop(s.photo.id, 'full'));
        }
        onProgress && onProgress(Math.min(1, t / tl.total));
        if (t >= tl.total) return resolve();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    rec.stop(); await stopped;
    stream.getTracks().forEach(tr => tr.stop());
    try { await ac.close(); } catch (e) { }
    try { wake && wake.release(); } catch (e) { }
    L.dropAll();
    if (signal && signal.aborted) return null;
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    return new Blob(chunks, { type });
  }

  /* ---------- UI ---------- */
  const extOf = type => type.includes('mp4') ? 'mp4' : 'webm';
  async function shareOrSave(blob, name) {
    try {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && !(window.claude && window.claude.use)) {
        await navigator.share({ files: [file], title: name }); return true;
      }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    return TB.UI.saveFile(blob, name);
  }
  function movieKey(spec) { return spec.type === 'region' ? 'r:' + spec.id : 't:' + spec.id; }

  async function open(spec) {
    const UI = TB.UI;
    const key = movieKey(spec);
    const saved = (Store.settings.movies || {})[key];
    const opts = { length: 'normal', bgm: 'box', bgmFile: null };
    const planOf = () => spec.type === 'region' ? regionPlan(spec.id, opts.length === 'short' ? 1 : 3) : tripPlan(spec.id, opts.length === 'short' ? 10 : 24);
    let plan = planOf(); if (!plan) return;
    const nPhotos = () => plan.places.reduce((s, p) => s + p.photos.length, 0);
    const pg = UI.page('思い出ムービー', `
      <div class="movie-wrap"><canvas id="mv-canvas" width="${W}" height="${H}" aria-label="ムービーのプレビュー"></canvas><video id="mv-video" playsinline controls hidden></video></div>
      <div class="stack" id="mv-panel"></div>`, async (el, close) => {
      const canvas = el.querySelector('#mv-canvas'), video = el.querySelector('#mv-video'), panel = el.querySelector('#mv-panel');
      let ctrl = null;
      const poster = async () => {
        plan = planOf();
        const tl = buildScenes(plan, opts), L = makeLoader();
        await Promise.all(plan.places.map(p => p.cover && L.load(p.cover, 'thumb')));
        const first = tl.scenes.find(s => s.type === 'photo'); if (first) await L.load(first.photo.id, 'full');
        try { await document.fonts.load(`600 40px "Klee One"`); } catch (e) { }
        drawAt(canvas.getContext('2d'), tl, 2.6, L, plan, Store.settings.bookName || ''); L.dropAll();
        return tl.total;
      };
      const showSaved = async () => {
        const b = await Store.getBlob('mv-' + key); if (!b) return false;
        video.src = URL.createObjectURL(b.full); video.hidden = false; canvas.hidden = true;
        return b.full;
      };
      const drawPanel = async (state) => {
        if (state === 'saved') {
          const blob = await showSaved(); if (!blob) return drawPanel('setup');
          panel.innerHTML = `<div class="row"><button class="btn primary" data-save>保存・共有</button><button class="btn" data-redo>作り直す</button></div>
            <p class="muted" style="margin:0;font-size:13px">${new Date(Store.settings.movies[key].createdAt).toLocaleString('ja-JP')} 作成 · ${(blob.size / 1048576).toFixed(1)}MB。iPhoneは「保存・共有」→「ビデオを保存」で写真アプリに入ります。</p>`;
          panel.querySelector('[data-save]').onclick = () => shareOrSave(blob, `${plan.title}.${extOf(blob.type)}`);
          panel.querySelector('[data-redo]').onclick = () => drawPanel('setup');
          return;
        }
        video.hidden = true; canvas.hidden = false; video.removeAttribute('src');
        const total = await poster();
        panel.innerHTML = `
          ${supported() ? '' : '<div class="banner"><p>このブラウザは動画の書き出しに対応していません。iPhoneはiOS 15以降のSafari、PCはChromeでお試しください。</p></div>'}
          <p style="margin:0">${esc(plan.title)} · 写真 <b>${nPhotos()}</b>枚 · 約<b>${Math.round(total)}</b>秒</p>
          ${nPhotos() ? '' : '<p class="muted" style="margin:0;font-size:13px">まだ思い出の写真がありません。写真なしでも地図とスタンプのムービーは作れます。</p>'}
          <div class="field">長さ<div class="seg" id="mv-len"><button data-l="short" aria-pressed="${opts.length === 'short'}">短め</button><button data-l="normal" aria-pressed="${opts.length === 'normal'}">ふつう</button></div></div>
          <div class="field">BGM<div class="seg" id="mv-bgm"><button data-b="box" aria-pressed="${opts.bgm === 'box'}">オルゴール</button><button data-b="file" aria-pressed="${opts.bgm === 'file'}">${opts.bgmFile ? esc(opts.bgmFile.name.slice(0, 12)) : '音楽ファイル'}</button><button data-b="none" aria-pressed="${opts.bgm === 'none'}">なし</button></div></div>
          <p class="muted" style="margin:0;font-size:12px">オルゴールはアプリが自動で作曲するので、SNSに載せても著作権の心配がありません。作成中は再生と同じ時間がかかります。画面を開いたままにしてください。</p>
          <div class="progress" id="mv-prog" hidden><i></i></div>
          <div class="row"><button class="btn primary" data-go ${supported() ? '' : 'disabled'}>🎬 ムービーをつくる</button>${saved || (Store.settings.movies || {})[key] ? '<button class="btn" data-back>保存済みを見る</button>' : ''}</div>`;
        panel.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { opts.length = b.dataset.l; drawPanel('setup'); });
        panel.querySelectorAll('[data-b]').forEach(b => b.onclick = async () => {
          if (b.dataset.b === 'file') { const [f] = await UI.filePick('audio/*', false); if (!f) return; opts.bgmFile = f; }
          opts.bgm = b.dataset.b; drawPanel('setup');
        });
        const back = panel.querySelector('[data-back]'); if (back) back.onclick = () => drawPanel('saved');
        panel.querySelector('[data-go]').onclick = async (ev) => {
          ev.target.disabled = true; ev.target.textContent = '撮影中…';
          panel.querySelectorAll('.seg button, [data-back]').forEach(b => b.disabled = true);
          const bar = panel.querySelector('#mv-prog'); bar.hidden = false;
          ctrl = new AbortController();
          try {
            const blob = await record(plan, opts, canvas, p => { bar.firstElementChild.style.width = (p * 100) + '%'; }, ctrl.signal);
            if (!blob) return;
            await Store.saveMovie(key, blob);
            drawPanel('saved');
            UI.toast('ムービーができました');
          } catch (e) { UI.toast('作成に失敗しました：' + e.message); drawPanel('setup'); }
        };
      };
      el.querySelector('[data-close]').addEventListener('click', () => { if (ctrl) ctrl.abort(); });
      drawPanel((Store.settings.movies || {})[key] ? 'saved' : 'setup');
    });
    return pg;
  }

  TB.Movie = { open, regionPlan, tripPlan, buildScenes, drawAt, makeLoader, record, supported, W, H };
})();
