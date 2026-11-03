/* TABIROGU — storage layer (IndexedDB) and ZIP import/export */
(function () {
  const DB_NAME = 'tabriogu', DB_VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('trips')) d.createObjectStore('trips', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' }).createIndex('tripId', 'tripId');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function tx(stores, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then(v => { out = v; }, rej);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const getAll = (s) => tx([s], 'readonly', t => req(t.objectStore(s).getAll()));
  const get = (s, k) => tx([s], 'readonly', t => req(t.objectStore(s).get(k)));
  const put = (s, v) => tx([s], 'readwrite', t => { t.objectStore(s).put(v); });

  async function toBuf(b) {
    if (b == null || b instanceof ArrayBuffer) return b;
    if (b.arrayBuffer) return b.arrayBuffer();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(b); });
  }
  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const DEFAULT_SETTINGS = { key: 'settings', bookName: 'ふたりの旅帳', covers: {}, lastExport: null, persisted: false };

  const Store = {
    uid,
    trips: [], photos: [], settings: { ...DEFAULT_SETTINGS },
    async load() {
      const [trips, photos, s] = await Promise.all([getAll('trips'), getAll('photos'), get('meta', 'settings')]);
      this.trips = trips; this.photos = photos;
      this.settings = Object.assign({ ...DEFAULT_SETTINGS }, s || {});
    },
    async saveSettings() { await put('meta', this.settings); },
    newTrip(o = {}) {
      const now = Date.now();
      return Object.assign({ id: uid('t'), title: '', status: 'done', startDate: '', endDate: '', places: [], memo: '', coverPhotoId: null, days: [], createdAt: now, updatedAt: now }, o);
    },
    async saveTrip(t) {
      t.updatedAt = Date.now();
      await put('trips', t);
      const i = this.trips.findIndex(x => x.id === t.id);
      if (i >= 0) this.trips[i] = t; else this.trips.push(t);
      return t;
    },
    async deleteTrip(id) {
      const ph = this.photos.filter(p => p.tripId === id).map(p => p.id);
      await tx(['trips', 'photos', 'blobs'], 'readwrite', t => {
        t.objectStore('trips').delete(id);
        ph.forEach(pid => { t.objectStore('photos').delete(pid); t.objectStore('blobs').delete(pid); });
      });
      this.trips = this.trips.filter(t => t.id !== id);
      this.photos = this.photos.filter(p => p.tripId !== id);
      ph.forEach(pid => URLS.drop(pid));
    },
    async addPhotos(list) { // list: [{meta, full, thumb}]
      // Safari can lose Blobs kept in IndexedDB, so image bytes are stored as ArrayBuffer
      const recs = await Promise.all(list.map(async x => ({ id: x.meta.id, type: (x.full && x.full.type) || 'image/jpeg', full: await toBuf(x.full), thumb: await toBuf(x.thumb) })));
      await tx(['photos', 'blobs'], 'readwrite', t => {
        list.forEach((x, i) => { t.objectStore('photos').put(x.meta); t.objectStore('blobs').put(recs[i]); });
      });
      list.forEach(x => this.photos.push(x.meta));
    },
    async savePhoto(p) { await put('photos', p); const i = this.photos.findIndex(x => x.id === p.id); if (i >= 0) this.photos[i] = p; },
    async deletePhoto(id) {
      await tx(['photos', 'blobs'], 'readwrite', t => { t.objectStore('photos').delete(id); t.objectStore('blobs').delete(id); });
      this.photos = this.photos.filter(p => p.id !== id); URLS.drop(id);
      this.trips.forEach(t => { if (t.coverPhotoId === id) t.coverPhotoId = null; });
      for (const k in this.settings.covers) if (this.settings.covers[k] === id) delete this.settings.covers[k];
    },
    async getBlob(id) {
      const r = await get('blobs', id); if (!r) return null;
      const type = r.type || 'image/jpeg';
      const as = v => v == null ? v : (v instanceof Blob ? v : new Blob([v], { type }));
      return { id: r.id, full: as(r.full), thumb: as(r.thumb) };
    },
    /* convert images saved by older versions (Blob) to ArrayBuffer; returns how many could not be read */
    async migrateBlobs() {
      const keys = await tx(['blobs'], 'readonly', t => req(t.objectStore('blobs').getAllKeys()));
      let converted = 0, broken = 0;
      for (const k of keys) {
        const r = await get('blobs', k);
        if (!r || !((r.full instanceof Blob) || (r.thumb instanceof Blob))) continue;
        try {
          const rec = { id: r.id, type: (r.full && r.full.type) || 'image/jpeg', full: await toBuf(r.full), thumb: await toBuf(r.thumb) };
          await put('blobs', rec); converted++;
        } catch (e) { broken++; }
      }
      this.brokenImages = broken;
      return { converted, broken };
    },
    async saveMovie(key, blob) {
      await put('blobs', { id: 'mv-' + key, type: blob.type, full: await toBuf(blob), thumb: null });
      this.settings.movies = this.settings.movies || {};
      this.settings.movies[key] = { createdAt: Date.now(), type: blob.type, size: blob.size };
      await this.saveSettings();
    },
    async clearAll() {
      await tx(['trips', 'photos', 'blobs', 'meta'], 'readwrite', t => { ['trips', 'photos', 'blobs'].forEach(s => t.objectStore(s).clear()); });
      this.trips = []; this.photos = []; this.settings.movies = {}; URLS.clear();
    },
    async requestPersist() {
      try {
        if (navigator.storage && navigator.storage.persist && !this.settings.persisted) {
          this.settings.persisted = await navigator.storage.persist();
          await this.saveSettings();
        }
      } catch (e) { /* not supported */ }
    },

    /* ---------- ZIP ---------- */
    async exportZip(onProgress, tripIds) {
      const zip = new JSZip();
      const only = tripIds ? new Set(tripIds) : null;
      const trips = only ? this.trips.filter(t => only.has(t.id)) : this.trips;
      const photos = only ? this.photos.filter(p => only.has(p.tripId)) : this.photos;
      const data = { format: 'tabriogu', version: 2, exportedAt: new Date().toISOString(), bookName: this.settings.bookName, covers: only ? {} : this.settings.covers, trips, photos };
      zip.file('tabriogu.json', JSON.stringify(data, null, 1));
      const dir = zip.folder('photos');
      let i = 0;
      for (const p of photos) {
        const b = await this.getBlob(p.id);
        if (b) { dir.file(p.id + '.jpg', b.full); dir.file(p.id + '_t.jpg', b.thumb); }
        onProgress && onProgress(++i / Math.max(1, photos.length) * .7);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => onProgress && onProgress(.7 + m.percent / 100 * .3));
      if (!only) { this.settings.lastExport = Date.now(); await this.saveSettings(); }
      return blob;
    },
    async readZip(file) {
      const zip = await JSZip.loadAsync(file);
      const jf = zip.file('tabriogu.json');
      if (!jf) throw new Error('TABIROGUのZIPではありません（tabriogu.json が見つかりません）');
      const data = JSON.parse(await jf.async('string'));
      if (data.format !== 'tabriogu') throw new Error('TABIROGUのZIPではありません');
      return { zip, data };
    },
    async importZip({ zip, data }, mode, onProgress) {
      if (mode === 'replace') await this.clearAll();
      const byId = new Map(this.trips.map(t => [t.id, t]));
      let addedTrips = 0, updatedTrips = 0, addedPhotos = 0;
      for (const t of data.trips || []) {
        const cur = byId.get(t.id);
        if (!cur) { await put('trips', t); this.trips.push(t); addedTrips++; }
        else if ((t.updatedAt || 0) > (cur.updatedAt || 0)) { await put('trips', t); Object.assign(cur, t); updatedTrips++; }
      }
      const have = new Set(this.photos.map(p => p.id));
      const list = data.photos || [];
      let i = 0;
      for (const p of list) {
        i++;
        if (have.has(p.id)) continue;
        const f = zip.file('photos/' + p.id + '.jpg'), th = zip.file('photos/' + p.id + '_t.jpg');
        if (!f) continue;
        const full = await f.async('blob');
        const thumb = th ? await th.async('blob') : full;
        await this.addPhotos([{ meta: p, full: new Blob([full], { type: 'image/jpeg' }), thumb: new Blob([thumb], { type: 'image/jpeg' }) }]);
        addedPhotos++;
        onProgress && onProgress(i / list.length);
      }
      if (mode === 'replace') { this.settings.bookName = data.bookName || this.settings.bookName; this.settings.covers = data.covers || {}; }
      else this.settings.covers = Object.assign({}, data.covers || {}, this.settings.covers);
      await this.saveSettings();
      return { addedTrips, updatedTrips, addedPhotos };
    }
  };

  /* object URL cache for thumbs/full images */
  const URLS = {
    m: new Map(),
    async get(id, kind = 'thumb') {
      const k = id + ':' + kind;
      if (this.m.has(k)) return this.m.get(k);
      const b = await Store.getBlob(id);
      if (!b || !(b[kind] || b.full)) return '';
      const u = URL.createObjectURL(b[kind] || b.full);
      this.m.set(k, u);
      return u;
    },
    drop(id) { ['thumb', 'full'].forEach(kind => { const k = id + ':' + kind; if (this.m.has(k)) { URL.revokeObjectURL(this.m.get(k)); this.m.delete(k); } }); },
    clear() { this.m.forEach(u => URL.revokeObjectURL(u)); this.m.clear(); }
  };

  /* show a photo inside any box with a real <img> (iPhone Safari may not paint blob: URLs used as CSS backgrounds) */
  function setImg(el, url) {
    if (!el || !url) return;
    let im = el;
    if (el.tagName !== 'IMG') {
      im = [...el.children].find(c => c.classList && c.classList.contains('bgimg'));
      if (!im) { im = document.createElement('img'); im.className = 'bgimg'; im.alt = ''; el.prepend(im); }
    }
    const id = el.dataset.cov || el.dataset.cover || el.dataset.img || el.dataset.src;
    im.onerror = async () => { // blob: URL refused → fall back to a data: URL
      im.onerror = null;
      try {
        const b = await Store.getBlob(id); const blob = b && (b.thumb || b.full); if (!blob) return;
        im.src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
        TB.imgFallbacks = (TB.imgFallbacks || 0) + 1;
      } catch (e) { TB.imgErrors = (TB.imgErrors || 0) + 1; }
    };
    im.src = url;
  }
  window.TB = window.TB || {};
  TB.Store = Store; TB.URLS = URLS; TB.setImg = setImg;
})();
