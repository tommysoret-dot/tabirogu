/* TABRIOGU — photo processing: EXIF, resize, grouping into trips */
(function () {
  const FULL = 1600, THUMB = 600;
  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      // fallback via <img> (e.g. Safari HEIC)
      const url = URL.createObjectURL(file);
      try {
        const img = new Image(); img.decoding = 'async'; img.src = url;
        await img.decode(); return img;
      } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
    }
  }
  function toBlob(src, max, q) {
    const w0 = src.width, h0 = src.height, s = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * s), h = Math.round(h0 * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return new Promise(r => c.toBlob(b => r({ blob: b, w, h }), 'image/jpeg', q));
  }
  function localDate(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  async function processFile(file) {
    let meta = {};
    try { meta = await exifr.parse(file, { gps: true, tiff: true, exif: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] }) || {}; } catch (e) { meta = {}; }
    const dt = meta.DateTimeOriginal || meta.CreateDate;
    const takenAt = dt instanceof Date && !isNaN(dt) ? dt.getTime() : (file.lastModified || Date.now());
    const lat = typeof meta.latitude === 'number' ? meta.latitude : null;
    const lng = typeof meta.longitude === 'number' ? meta.longitude : null;
    const img = await decode(file);
    const full = await toBlob(img, FULL, .85), thumb = await toBlob(img, THUMB, .8);
    if (img.close) img.close();
    return {
      meta: { id: TB.Store.uid('p'), tripId: null, takenAt, dateGuessed: !(dt instanceof Date), lat, lng, place: TB.Geo.locate(lat, lng), caption: '', w: full.w, h: full.h, name: file.name, createdAt: Date.now() },
      full: full.blob, thumb: thumb.blob
    };
  }

  /* Group photos: match an existing trip by date, otherwise cluster by gaps > 36h */
  function group(items, trips) {
    items.sort((a, b) => a.meta.takenAt - b.meta.takenAt);
    const groups = [];
    const byTrip = new Map();
    let cur = null, last = 0;
    for (const it of items) {
      const d = localDate(it.meta.takenAt);
      const t = trips.find(t => t.startDate && d >= t.startDate && d <= (t.endDate || t.startDate));
      if (t) {
        if (!byTrip.has(t.id)) { const g = { items: [], target: t.id }; byTrip.set(t.id, g); groups.push(g); }
        byTrip.get(t.id).items.push(it); continue;
      }
      if (!cur || it.meta.takenAt - last > 36 * 3600e3) { cur = { items: [], target: 'new' }; groups.push(cur); }
      cur.items.push(it); last = it.meta.takenAt;
    }
    groups.forEach(g => {
      const ts = g.items.map(i => i.meta.takenAt);
      g.start = localDate(Math.min(...ts)); g.end = localDate(Math.max(...ts));
      const count = {};
      g.items.forEach(i => { if (i.meta.place) count[i.meta.place] = (count[i.meta.place] || 0) + 1; });
      g.places = Object.keys(count).sort((a, b) => count[b] - count[a]);
      g.fallbackPlace = g.places[0] || '';
      g.title = suggestTitle(g);
    });
    return groups;
  }
  function suggestTitle(g) {
    const [y, m] = g.start.split('-');
    const names = g.places.slice(0, 2).map(k => TB.Geo.placeName(k).replace(/(都|府|県)$/, ''));
    return `${+y}年${+m}月 ` + (names.length ? names.join('・') + 'の旅' : 'の旅');
  }

  /* resize any image blob (e.g. images embedded in a KOZYBOOK html) */
  async function resizeBlob(blob) {
    const img = await decode(blob);
    const full = await toBlob(img, FULL, .85), thumb = await toBlob(img, THUMB, .8);
    if (img.close) img.close();
    return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
  }
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(u); if (!m) return null;
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: m[1] || 'application/octet-stream' });
    const bin = atob(m[3]); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] || 'image/jpeg' });
  }
  TB.Photos = { processFile, group, localDate, resizeBlob, dataUrlToBlob };
})();
