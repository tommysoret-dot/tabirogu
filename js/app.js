/* TABRIOGU — UI */
(function () {
  const { Store, URLS, Geo, Photos } = TB;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = {
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    medal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="14" r="6"/><path d="M8.5 9 6 3h4l2 4 2-4h4l-2.5 6"/><path d="m12 11.5.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
  };
  const fmtDate = (s) => s ? s.replace(/-/g, '.') : '';
  const fmtRange = (a, b) => !a ? '日付未設定' : (b && b !== a ? `${fmtDate(a)} – ${b.slice(0, 4) === a.slice(0, 4) ? fmtDate(b).slice(5) : fmtDate(b)}` : fmtDate(a));
  const nights = (a, b) => { if (!a || !b) return ''; const n = Math.round((new Date(b) - new Date(a)) / 864e5); return n > 0 ? `${n}泊${n + 1}日` : '日帰り'; };

  let state = { tab: 'map', mapMode: 'jp', tripFilter: 'all', calc: null };
  const recalc = () => { state.calc = Geo.compute(Store.trips, Store.photos); $('#ptsVal').textContent = state.calc.points.toLocaleString(); };

  /* ---------- downloads (works in published artifact and on a normal site) ---------- */
  async function saveFile(blob, filename) {
    try {
      if (window.claude && window.claude.use) {
        const d = await window.claude.use('downloads');
        if (d) { await d.save({ filename, data: blob }); return true; }
      }
    } catch (e) { if (e && e.code === 'declined') return false; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }

  /* ---------- toast / overlays ---------- */
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  function sheet(html, onMount) {
    const o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => o.remove();
    o.addEventListener('click', e => { if (e.target === o) close(); });
    document.body.appendChild(o);
    onMount && onMount(o.firstElementChild, close);
    return close;
  }
  function page(title, html, onMount, actions = '') {
    const p = document.createElement('div'); p.className = 'page';
    p.innerHTML = `<div class="page-head"><button class="icon-btn" data-close aria-label="戻る">${I.back}</button><div class="title">${esc(title)}</div>${actions}</div><div class="page-body"><div class="inner">${html}</div></div>`;
    const close = () => p.remove();
    p.querySelector('[data-close]').onclick = close;
    document.body.appendChild(p);
    onMount && onMount(p, close);
    return { el: p, close };
  }
  function filePick(accept, multiple) {
    return new Promise(res => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multiple;
      i.style.display = 'none'; document.body.appendChild(i);
      i.onchange = () => { res([...i.files]); i.remove(); };
      i.click();
    });
  }

  /* ---------- cover photo for a place ---------- */
  function photosOfPlace(key, onlyDone = true) {
    const done = new Set(Store.trips.filter(t => t.status === 'done').map(t => t.id));
    return Store.photos.filter(p => (!onlyDone || done.has(p.tripId)) && (p.place === key || (key === 'w:JP' && p.place && p.place.startsWith('jp:'))))
      .sort((a, b) => b.takenAt - a.takenAt);
  }
  function coverFor(key) {
    const c = Store.settings.covers[key];
    const list = photosOfPlace(key);
    if (c && list.find(p => p.id === c)) return c;
    return list[0] ? list[0].id : null;
  }

  /* ================= MAP ================= */
  const MapView = {
    zoom: null, transforms: {}, built: null,
    async render() {
      const v = $('#view');
      v.className = 'view map-view';
      const c = state.calc;
      const total = state.mapMode === 'jp' ? 47 : Geo.worldRegions.reduce((s, r) => s + r.members.length, 0);
      const got = state.mapMode === 'jp' ? c.jpCount : c.wCount;
      v.innerHTML = `
        <div class="map-tools">
          <div class="seg" role="group" aria-label="地図の切り替え">
            <button data-mode="jp" aria-pressed="${state.mapMode === 'jp'}">日本</button>
            <button data-mode="world" aria-pressed="${state.mapMode === 'world'}">世界</button>
          </div>
          <div class="map-count"><b>${got}</b> / ${total}<br><span class="muted" style="font-size:12px">${state.mapMode === 'jp' ? '都道府県' : 'の国・地域'}</span></div>
        </div>
        <svg id="mapSvg" role="img" aria-label="${state.mapMode === 'jp' ? '日本地図' : '世界地図'}"></svg>
        <div class="map-legend"><span><i class="lg-v"></i>行った</span><span><i class="lg-p"></i>予定</span><span><i style="background:var(--map-empty)"></i>まだ</span></div>
        <div class="zoom-btns"><button data-z="in" aria-label="拡大">＋</button><button data-z="out" aria-label="縮小">－</button><button data-z="reset" aria-label="全体表示" style="font-size:13px">全</button></div>`;
      v.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.mapMode = b.dataset.mode; this.render(); });
      await this.draw();
    },
    async draw() {
      const svgEl = $('#mapSvg'); if (!svgEl) return;
      const W = svgEl.clientWidth || 400, H = svgEl.clientHeight || 600;
      const svg = d3.select(svgEl).attr('viewBox', `0 0 ${W} ${H}`);
      svg.selectAll('*').remove();
      const defs = svg.append('defs');
      defs.append('pattern').attr('id', 'hatch').attr('width', 6).attr('height', 6).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)')
        .html('<rect width="6" height="6" fill="var(--map-empty)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--stamp)" stroke-width="1.6" stroke-opacity=".7"/>');
      const g = svg.append('g');
      const top = 64, bottom = 110;
      let features, pathFor, insets = [];
      if (state.mapMode === 'jp') {
        features = Geo.jp.features;
        const box = { type: 'Polygon', coordinates: [[[128.6, 30.6], [128.6, 45.6], [146.2, 45.6], [146.2, 30.6], [128.6, 30.6]]] };
        const proj = d3.geoMercator().fitExtent([[10, top], [W - 10, H - bottom]], box);
        const ok = features.find(f => f.properties.id === 47);
        const pOk = d3.geoMercator().scale(proj.scale()).center([126.5, 25.9]);
        const okb = d3.geoPath(pOk).bounds(ok);
        const ow = okb[1][0] - okb[0][0], oh = okb[1][1] - okb[0][1];
        // place Okinawa inset in the empty top-left corner
        const ox = 16, oy = top + 8;
        pOk.translate([pOk.translate()[0] - okb[0][0] + ox + 6, pOk.translate()[1] - okb[0][1] + oy + 6]);
        insets.push([ox, oy, ow + 12, oh + 12]);
        const pMain = d3.geoPath(proj), pO = d3.geoPath(pOk);
        pathFor = f => (f.properties.id === 47 ? pO : pMain);
      } else {
        features = Geo.world.features.filter(f => f.properties.c !== 'AQ');
        const proj = d3.geoNaturalEarth1().fitExtent([[6, top], [W - 6, H - bottom]], { type: 'FeatureCollection', features });
        const p = d3.geoPath(proj); pathFor = () => p;
      }
      const c = state.calc;
      const base = g.append('g'), photo = g.append('g').attr('pointer-events', 'none'), outl = g.append('g');
      insets.forEach(([x, y, w, h]) => g.insert('rect', ':first-child').attr('class', 'inset-frame').attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('rx', 4));
      const visitedKeys = [];
      features.forEach(f => {
        const d = pathFor(f)(f); if (!d) return;
        const k = f.key, vis = c.visited.has(k);
        const p = base.append('path').attr('d', d).attr('class', 'region' + (!vis && c.planned.has(k) ? ' planned' : '') + (vis ? ' visited-fill' : '')).attr('data-key', k);
        p.append('title').text(Geo.placeName(k));
        if (vis) visitedKeys.push([k, d, pathFor(f).bounds(f)]);
      });
      for (const [k, d, b] of visitedKeys) {
        const pid = coverFor(k);
        outl.append('path').attr('d', d).attr('class', 'region-outline');
        if (!pid) continue;
        const id = 'cp' + k.replace(/[^a-zA-Z0-9]/g, '');
        defs.append('clipPath').attr('id', id).append('path').attr('d', d);
        const url = await URLS.get(pid, 'thumb');
        const [[x0, y0], [x1, y1]] = b;
        photo.append('image').attr('href', url).attr('x', x0).attr('y', y0).attr('width', Math.max(1, x1 - x0)).attr('height', Math.max(1, y1 - y0))
          .attr('preserveAspectRatio', 'xMidYMid slice').attr('clip-path', `url(#${id})`);
      }
      base.on('click', (e) => { const k = e.target.getAttribute && e.target.getAttribute('data-key'); if (k) placeSheet(k); });
      const maxK = state.mapMode === 'jp' ? 14 : 40;
      this.zoom = d3.zoom().scaleExtent([1, maxK]).translateExtent([[-W * .3, -H * .3], [W * 1.3, H * 1.3]]).clickDistance(8)
        .on('zoom', e => { g.attr('transform', e.transform); this.transforms[state.mapMode] = e.transform; });
      svg.call(this.zoom).on('dblclick.zoom', null);
      if (this.transforms[state.mapMode]) svg.call(this.zoom.transform, this.transforms[state.mapMode]);
      document.querySelectorAll('[data-z]').forEach(b => b.onclick = () => {
        const z = b.dataset.z;
        if (z === 'reset') svg.transition().duration(300).call(this.zoom.transform, d3.zoomIdentity);
        else svg.transition().duration(250).call(this.zoom.scaleBy, z === 'in' ? 1.6 : 1 / 1.6);
      });
    }
  };

  /* ================= PLACE SHEET ================= */
  async function placeSheet(key) {
    const name = Geo.placeName(key);
    const c = state.calc, vis = c.visited.has(key);
    let regionLine = '';
    if (key.startsWith('jp:')) {
      const r = c.jpRegions.find(r => r.prefs.includes(+key.slice(3)));
      regionLine = `${r.name}地方 ${r.got}/${r.total}${r.done ? '（制覇）' : ''}`;
    } else {
      const rid = Geo.countryRegion[key.slice(2)];
      const r = c.worldRegions.find(r => r.id === rid);
      if (r) regionLine = `${r.name} ${r.got}/${r.total}${r.done ? '（制覇）' : ''}`;
    }
    const trips = Store.trips.filter(t => (t.places || []).includes(key) || (key === 'w:JP' && (t.places || []).some(p => p.startsWith('jp:'))) || Store.photos.some(p => p.tripId === t.id && (p.place === key || (key === 'w:JP' && p.place && p.place.startsWith('jp:')))))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const photos = photosOfPlace(key).slice(0, 30);
    const cover = coverFor(key);
    sheet(`
      <div class="stack">
        <div class="place-head">
          <div class="t"><div class="eyebrow">${esc(regionLine)}</div><h2>${esc(name)}</h2></div>
          ${vis ? '<div class="stampmark">訪問<br>済</div>' : c.planned.has(key) ? '<span class="badge plan">予定あり</span>' : '<span class="badge sample">まだ</span>'}
        </div>
        ${photos.length ? `<div><div class="muted" style="font-size:12px">タップすると地図の表紙写真になります</div><div class="strip">${photos.map(p => `<button data-cover="${p.id}" class="${p.id === cover ? 'is-cover' : ''}" aria-label="表紙にする"></button>`).join('')}</div></div>` : ''}
        ${trips.length ? `<div class="mini-trips">${trips.map(t => `<button data-trip="${t.id}"><span>${esc(t.title || '無題の旅')}</span><span class="mono muted" style="font-size:12px">${fmtDate(t.startDate)} ${t.status === 'plan' ? '予定' : ''}</span></button>`).join('')}</div>` : '<p class="muted" style="margin:0">まだこの場所の旅はありません。</p>'}
        <div class="row"><button class="btn primary" data-new="done">${esc(name)}の旅を記録</button><button class="btn" data-new="plan">計画する</button></div>
      </div>`, async (el, close) => {
      for (const b of el.querySelectorAll('[data-cover]')) b.style.backgroundImage = `url(${await URLS.get(b.dataset.cover)})`;
      el.querySelectorAll('[data-cover]').forEach(b => b.onclick = async () => {
        Store.settings.covers[key] = b.dataset.cover; await Store.saveSettings();
        el.querySelectorAll('[data-cover]').forEach(x => x.classList.toggle('is-cover', x === b));
        if (state.tab === 'map') MapView.draw();
      });
      el.querySelectorAll('[data-trip]').forEach(b => b.onclick = () => { close(); openTrip(b.dataset.trip); });
      el.querySelectorAll('[data-new]').forEach(b => b.onclick = () => { close(); editTrip(Store.newTrip({ status: b.dataset.new, places: [key] }), true); });
    });
  }

  /* ================= TRIPS LIST ================= */
  async function renderTrips() {
    const v = $('#view'); v.className = 'view';
    const f = state.tripFilter;
    const list = Store.trips.filter(t => f === 'all' || t.status === f).sort((a, b) => (b.startDate || '9').localeCompare(a.startDate || '9'));
    const needBackup = Store.photos.length > 0 && (!Store.settings.lastExport || Date.now() - Store.settings.lastExport > 30 * 864e5);
    v.innerHTML = `
      ${needBackup ? `<div class="banner"><p>写真は端末のブラウザ内だけに保存されています。月に1回はZIPでバックアップしておくと安心です。</p><button class="btn small stamp" data-go="prefs">バックアップ</button></div>` : ''}
      <div class="list-head">
        <div><div class="eyebrow">${esc(Store.settings.bookName)}</div><h2>旅帳</h2></div>
        <div class="seg filter" role="group" aria-label="絞り込み">
          ${[['all', 'すべて'], ['done', '実績'], ['plan', '予定']].map(([k, l]) => `<button data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}
        </div>
      </div>
      ${list.length ? `<div class="trip-list">${list.map(t => {
      const n = Store.photos.filter(p => p.tripId === t.id).length;
      const places = (t.places || []).slice(0, 3).map(k => Geo.placeName(k)).join('・');
      return `<button class="ticket tape" data-trip="${t.id}">
          <div class="cover" data-cov="${t.coverPhotoId || ''}">${t.coverPhotoId ? '' : (t.status === 'plan' ? 'これから' : 'no photo')}</div>
          <div class="body">
            <div class="date">${fmtRange(t.startDate, t.endDate)}</div>
            <h3>${esc(t.title || '無題の旅')}</h3>
            <div class="muted" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(places)}</div>
            <div class="meta"><span class="badge ${t.status}">${t.status === 'done' ? '実績' : '予定'}</span>${t.sample ? '<span class="badge sample">サンプル</span>' : ''}<span>${n}枚</span><span>${nights(t.startDate, t.endDate)}</span></div>
          </div></button>`;
    }).join('')}</div>` : emptyTrips()}`;
    v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.tripFilter = b.dataset.f; renderTrips(); });
    v.querySelectorAll('[data-trip]').forEach(b => b.onclick = () => openTrip(b.dataset.trip));
    v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    v.querySelectorAll('[data-sample]').forEach(b => b.onclick = loadSample);
    v.querySelectorAll('[data-import]').forEach(b => b.onclick = startImport);
    for (const el of v.querySelectorAll('[data-cov]')) if (el.dataset.cov) el.style.backgroundImage = `url(${await URLS.get(el.dataset.cov)})`;
  }
  function emptyTrips() {
    return `<div class="empty"><div class="stampmark">旅帳<br>白紙</div>
      <h3>最初の旅を貼りましょう</h3>
      <p class="muted">旅行中の写真をまとめて選ぶと、撮影日と位置情報から旅と都道府県・国を自動で振り分けます。</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-import>${I.camera} 写真から旅をつくる</button><button class="btn" data-sample>サンプルで試す</button></div></div>`;
  }

  /* ================= TRIP DETAIL ================= */
  async function openTrip(id) {
    const t = Store.trips.find(x => x.id === id); if (!t) return;
    const photos = Store.photos.filter(p => p.tripId === id).sort((a, b) => a.takenAt - b.takenAt);
    const pg = page(t.title || '無題の旅', `
      <div class="trip-hero tape">
        <div class="t">
          <div class="mono muted">${fmtRange(t.startDate, t.endDate)} <span style="margin-left:6px">${nights(t.startDate, t.endDate)}</span></div>
          <h2>${esc(t.title || '無題の旅')}</h2>
          <div class="chips">${(t.places || []).map(k => `<span class="chip">${esc(Geo.placeName(k))}</span>`).join('') || '<span class="muted">場所未設定</span>'}</div>
        </div>
        ${t.status === 'done' ? '<div class="stampmark">旅の<br>記録</div>' : '<div class="stampmark" style="border-style:dashed">旅の<br>計画</div>'}
      </div>
      <div class="row"><button class="btn primary" data-act="photos">${I.camera} 写真を追加</button><button class="btn" data-act="edit">${I.edit} 編集</button>
        ${t.status === 'plan' ? '<button class="btn stamp" data-act="markdone">行ってきた！実績にする</button>' : ''}</div>
      ${t.memo ? `<div><div class="section-title"><h3>メモ</h3></div><div class="memo">${esc(t.memo)}</div></div>` : ''}
      <div>
        <div class="section-title"><h3>写真</h3><span class="mono muted">${photos.length}枚</span></div>
        ${photos.length ? `<div class="polaroids">${photos.map((p, i) => `<button class="polaroid" style="--r:${((i * 37) % 7) - 3}deg" data-photo="${p.id}"><img alt="" data-src="${p.id}">${p.place ? '' : '<b class="nopin" title="場所未設定">?</b>'}<span>${esc(p.caption || Geo.placeName(p.place))}</span></button>`).join('')}</div>` : '<p class="muted">まだ写真がありません。</p>'}
      </div>
      <div class="muted" style="font-size:12px">${t.sample ? 'サンプルデータです。設定画面からまとめて削除できます。' : ''}</div>
    `, async (el, close) => {
      for (const img of el.querySelectorAll('img[data-src]')) img.src = await URLS.get(img.dataset.src);
      el.querySelector('[data-act="edit"]').onclick = () => { close(); editTrip(t); };
      el.querySelector('[data-act="photos"]').onclick = async () => { const files = await filePick('image/*', true); if (files.length) { close(); importFlow(files, t.id); } };
      const md = el.querySelector('[data-act="markdone"]');
      if (md) md.onclick = async () => {
        const before = state.calc; t.status = 'done'; await Store.saveTrip(t); recalc(); refresh();
        close(); openTrip(t.id); celebrate(Geo.diff(before, state.calc));
      };
      el.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => photoViewer(b.dataset.photo, () => { close(); openTrip(id); }));
    });
    return pg;
  }

  /* ================= TRIP EDITOR ================= */
  function editTrip(t, isNew = false) {
    const draft = JSON.parse(JSON.stringify(t));
    const pg = page(isNew ? '新しい旅' : '旅を編集', `
      <form id="tripForm" class="stack">
        <div class="seg" role="group" aria-label="種類">
          <button type="button" data-st="done" aria-pressed="${draft.status === 'done'}">実績（行った）</button>
          <button type="button" data-st="plan" aria-pressed="${draft.status === 'plan'}">予定（行く）</button>
        </div>
        <label class="field">旅の名前<input id="f-title" required value="${esc(draft.title)}" placeholder="例：春の大阪・京都"></label>
        <div class="two">
          <label class="field">出発日<input id="f-start" type="date" value="${esc(draft.startDate)}"></label>
          <label class="field">帰着日<input id="f-end" type="date" value="${esc(draft.endDate)}"></label>
        </div>
        <div class="field">行き先（都道府県・国）<div class="chips" id="f-places"></div></div>
        <label class="field">メモ<textarea id="f-memo" placeholder="印象に残ったこと、次に行きたいところ…">${esc(draft.memo)}</textarea></label>
        <button class="btn primary block" type="submit">保存</button>
        ${isNew ? '' : '<div id="delZone"><button type="button" class="btn stamp small" data-del>この旅を削除</button></div>'}
      </form>`, (el, close) => {
      const drawPlaces = () => {
        el.querySelector('#f-places').innerHTML = draft.places.map(k => `<span class="chip">${esc(Geo.placeName(k))}<button type="button" data-rm="${k}" aria-label="外す">×</button></span>`).join('') + '<button type="button" class="chip add" data-addp>＋ 追加</button>';
        el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { draft.places = draft.places.filter(k => k !== b.dataset.rm); drawPlaces(); });
        el.querySelector('[data-addp]').onclick = () => picker(draft.places, true, sel => { draft.places = sel; drawPlaces(); });
      };
      drawPlaces();
      el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { draft.status = b.dataset.st; el.querySelectorAll('[data-st]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        el.querySelector('#delZone').innerHTML = `<div class="banner"><p>「${esc(draft.title)}」と写真${Store.photos.filter(p => p.tripId === t.id).length}枚を削除します。元に戻せません。</p><button type="button" class="btn danger small" data-yes>削除する</button></div>`;
        el.querySelector('[data-yes]').onclick = async () => { await Store.deleteTrip(t.id); recalc(); close(); refresh(); toast('削除しました'); };
      };
      el.querySelector('#tripForm').onsubmit = async (e) => {
        e.preventDefault();
        draft.title = el.querySelector('#f-title').value.trim();
        draft.startDate = el.querySelector('#f-start').value;
        draft.endDate = el.querySelector('#f-end').value || draft.startDate;
        if (draft.endDate && draft.startDate && draft.endDate < draft.startDate) [draft.startDate, draft.endDate] = [draft.endDate, draft.startDate];
        draft.memo = el.querySelector('#f-memo').value;
        const before = state.calc;
        const saved = await Store.saveTrip(Object.assign(t, draft));
        await Store.requestPersist();
        recalc(); close(); refresh(); openTrip(saved.id);
        celebrate(Geo.diff(before, state.calc));
      };
    });
    return pg;
  }

  /* ================= PICKER ================= */
  function picker(selected, multi, cb) {
    let mode = (selected[0] || 'jp:').startsWith('w:') ? 'world' : 'jp';
    const sel = new Set(selected);
    sheet(`<div class="stack">
      <div class="row" style="justify-content:space-between"><div class="seg"><button data-pm="jp">日本</button><button data-pm="world">世界</button></div><button class="btn primary small" data-ok>決定</button></div>
      <input class="search" id="pk-q" placeholder="名前で探す（例：沖縄、フランス）" autocomplete="off">
      <div class="picker-list" id="pk-list"></div></div>`, (el, close) => {
      const draw = () => {
        el.querySelectorAll('[data-pm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pm === mode));
        const q = el.querySelector('#pk-q').value.trim();
        let html = '';
        if (mode === 'jp') {
          Geo.JP_REGIONS.forEach(r => {
            const items = r.prefs.filter(id => !q || Geo.prefName[id].includes(q));
            if (!items.length) return;
            html += `<div class="picker-group">${r.name}</div>` + items.map(id => `<button data-k="jp:${id}" aria-pressed="${sel.has('jp:' + id)}">${esc(Geo.prefName[id])}</button>`).join('');
          });
        } else {
          Geo.UN_REGIONS.forEach(([cont, subs]) => subs.forEach(([rid, rname]) => {
            const items = Geo.world.features.filter(f => f.properties.r === rid && (!q || f.properties.n.includes(q))).sort((a, b) => a.properties.n.localeCompare(b.properties.n, 'ja'));
            if (!items.length) return;
            html += `<div class="picker-group">${cont} · ${rname}</div>` + items.map(f => `<button data-k="${f.key}" aria-pressed="${sel.has(f.key)}">${esc(f.properties.n)}</button>`).join('');
          }));
        }
        const list = el.querySelector('#pk-list'); list.innerHTML = html || '<p class="muted">見つかりません</p>';
        list.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
          const k = b.dataset.k;
          if (!multi) { close(); cb([k]); return; }
          sel.has(k) ? sel.delete(k) : sel.add(k); b.setAttribute('aria-pressed', sel.has(k));
        });
      };
      el.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { mode = b.dataset.pm; draw(); });
      el.querySelector('#pk-q').oninput = draw;
      el.querySelector('[data-ok]').onclick = () => { close(); cb([...sel]); };
      if (!multi) el.querySelector('[data-ok]').hidden = true;
      draw();
    });
  }

  /* ================= PHOTO VIEWER ================= */
  async function photoViewer(id, onChange) {
    const p = Store.photos.find(x => x.id === id); if (!p) return;
    const t = Store.trips.find(x => x.id === p.tripId);
    const url = await URLS.get(id, 'full');
    const d = new Date(p.takenAt);
    sheet(`<div class="stack viewer">
      <img src="${url}" alt="${esc(p.caption)}">
      <div class="row" style="justify-content:space-between"><span class="mono muted">${d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}${p.dateGuessed ? '（推定）' : ''}</span>
        <button class="chip ${p.place ? '' : 'warn'}" data-place>📍 ${esc(Geo.placeName(p.place))}</button></div>
      <label class="field">ひとこと<input id="pv-cap" value="${esc(p.caption)}" placeholder="例：道頓堀でたこ焼き"></label>
      <div class="row">
        <button class="btn small" data-tc>この旅の表紙にする</button>
        ${p.place ? '<button class="btn small" data-mc>地図の表紙にする</button>' : ''}
        <span style="flex:1"></span><span id="pv-del"><button class="btn small stamp" data-del>削除</button></span>
      </div></div>`, (el, close) => {
      const done = () => { close(); onChange && onChange(); };
      el.querySelector('#pv-cap').onchange = async e => { p.caption = e.target.value; await Store.savePhoto(p); };
      el.querySelector('[data-place]').onclick = () => picker(p.place ? [p.place] : [], false, async ([k]) => {
        const before = state.calc; p.place = k; await Store.savePhoto(p); recalc(); refresh(); done(); celebrate(Geo.diff(before, state.calc));
      });
      el.querySelector('[data-tc]').onclick = async () => { if (t) { t.coverPhotoId = p.id; await Store.saveTrip(t); refresh(); toast('旅の表紙にしました'); } };
      const mc = el.querySelector('[data-mc]');
      if (mc) mc.onclick = async () => { Store.settings.covers[p.place] = p.id; await Store.saveSettings(); refresh(); toast(`${Geo.placeName(p.place)}の表紙にしました`); };
      el.querySelector('[data-del]').onclick = () => {
        el.querySelector('#pv-del').innerHTML = '<button class="btn small danger" data-yes>本当に削除</button>';
        el.querySelector('[data-yes]').onclick = async () => { await Store.deletePhoto(p.id); if (t) await Store.saveTrip(t); await Store.saveSettings(); recalc(); refresh(); done(); };
      };
    });
  }

  /* ================= IMPORT FLOW ================= */
  async function startImport() { const files = await filePick('image/*', true); if (files.length) importFlow(files); }
  async function importFlow(files, forcedTripId) {
    const pg = page('写真を取り込む', `<div class="stack" id="imp"><p>写真を読み込んでいます… <span class="mono" id="imp-n">0/${files.length}</span></p><div class="progress"><i id="imp-bar"></i></div></div>`);
    const items = [], failed = [];
    for (let i = 0; i < files.length; i++) {
      try { items.push(await Photos.processFile(files[i])); } catch (e) { failed.push(files[i].name); }
      const n = pg.el.querySelector('#imp-n'); if (!n) return; // closed
      n.textContent = `${i + 1}/${files.length}`; pg.el.querySelector('#imp-bar').style.width = ((i + 1) / files.length * 100) + '%';
    }
    let groups;
    if (forcedTripId) {
      const t = Store.trips.find(x => x.id === forcedTripId);
      groups = Photos.group(items, []); // for place/title stats
      const all = { items, target: forcedTripId, start: t.startDate, end: t.endDate, places: [...new Set(groups.flatMap(g => g.places))], title: t.title };
      all.fallbackPlace = all.places[0] || (t.places || [])[0] || '';
      groups = [all];
    } else groups = Photos.group(items, Store.trips);
    const thumbs = new Map();
    items.forEach(it => thumbs.set(it.meta.id, URL.createObjectURL(it.thumb)));
    const tripOpts = Store.trips.slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const box = pg.el.querySelector('#imp');
    const draw = () => {
      box.innerHTML = `
        <p>${items.length}枚を<b>${groups.length}つの旅</b>に分けました。${failed.length ? `<br><span style="color:var(--stamp)">読み込めなかった写真：${failed.map(esc).join('、')}</span>` : ''}</p>
        ${groups.map((g, gi) => {
        const noPin = g.items.filter(i => !i.meta.place).length;
        return `<div class="group tape" style="--tape-color:var(--tape-${(gi % 4) + 1})">
            <div class="row" style="justify-content:space-between"><span class="mono">${fmtRange(g.start, g.end)}</span><span class="muted">${g.items.length}枚</span></div>
            <div class="thumbs">${g.items.map(i => `<span class="wrap"><img src="${thumbs.get(i.meta.id)}" alt="">${i.meta.place ? '' : '<i>?</i>'}</span>`).join('')}</div>
            <div class="chips">${g.places.map(k => `<span class="chip">${esc(Geo.placeName(k))}</span>`).join('') || '<span class="muted" style="font-size:13px">位置情報のある写真がありません</span>'}</div>
            ${noPin ? `<div class="row" style="font-size:13px">位置情報なし ${noPin}枚 → <button class="chip ${g.fallbackPlace ? '' : 'warn'}" data-fb="${gi}">${esc(g.fallbackPlace ? Geo.placeName(g.fallbackPlace) : '場所を選ぶ')}</button></div>` : ''}
            ${forcedTripId ? `<p class="muted" style="margin:0;font-size:13px">「${esc(g.title)}」に追加します</p>` : `
            <label class="field">保存先
              <select data-target="${gi}">
                <option value="new" ${g.target === 'new' ? 'selected' : ''}>新しい旅として保存</option>
                ${tripOpts.map(t => `<option value="${t.id}" ${g.target === t.id ? 'selected' : ''}>${esc(t.title || '無題')}（${fmtDate(t.startDate)}）</option>`).join('')}
                <option value="skip" ${g.target === 'skip' ? 'selected' : ''}>このグループは取り込まない</option>
              </select></label>
            ${g.target === 'new' ? `<label class="field">旅の名前<input data-title="${gi}" value="${esc(g.title)}"></label>` : ''}`}
          </div>`;
      }).join('')}
        <button class="btn primary block" id="imp-save">旅帳に貼る</button>`;
      box.querySelectorAll('[data-target]').forEach(s => s.onchange = () => { groups[+s.dataset.target].target = s.value; draw(); });
      box.querySelectorAll('[data-title]').forEach(i => i.oninput = () => { groups[+i.dataset.title].title = i.value; });
      box.querySelectorAll('[data-fb]').forEach(b => b.onclick = () => picker(groups[+b.dataset.fb].fallbackPlace ? [groups[+b.dataset.fb].fallbackPlace] : [], false, ([k]) => { groups[+b.dataset.fb].fallbackPlace = k; draw(); }));
      box.querySelector('#imp-save').onclick = save;
    };
    const save = async () => {
      const btn = box.querySelector('#imp-save'); btn.disabled = true; btn.textContent = '保存中…';
      const before = state.calc;
      let firstTrip = null;
      for (const g of groups) {
        if (g.target === 'skip') continue;
        let t = g.target === 'new' ? Store.newTrip({ title: g.title.trim() || '無題の旅', status: 'done', startDate: g.start, endDate: g.end }) : Store.trips.find(x => x.id === g.target);
        const places = new Set(t.places || []);
        g.items.forEach(i => { i.meta.tripId = t.id; if (!i.meta.place && g.fallbackPlace) i.meta.place = g.fallbackPlace; if (i.meta.place) places.add(i.meta.place); });
        t.places = [...places];
        if (g.target !== 'new' && t.startDate) { if (g.start < t.startDate) t.startDate = g.start; if (g.end > (t.endDate || t.startDate)) t.endDate = g.end; }
        if (!t.coverPhotoId && g.items[0]) t.coverPhotoId = g.items[0].meta.id;
        await Store.addPhotos(g.items);
        await Store.saveTrip(t);
        firstTrip = firstTrip || t;
      }
      thumbs.forEach(u => URL.revokeObjectURL(u));
      await Store.requestPersist();
      recalc(); pg.close(); refresh();
      if (forcedTripId) openTrip(forcedTripId); else if (firstTrip && groups.filter(g => g.target !== 'skip').length === 1) openTrip(firstTrip.id);
      celebrate(Geo.diff(before, state.calc)) || toast('旅帳に貼りました');
    };
    draw();
  }

  /* ================= CELEBRATION ================= */
  function celebrate(diff) {
    if (!diff || (!diff.newPlaces.length && !diff.newRegions.length)) return false;
    const P = Geo.POINTS;
    const reg = diff.newRegions.map(r => `<li><b>${esc(r.name)}${r.prefs ? '地方' : ''} 制覇！</b> ボーナス +${r.bonus}pt</li>`).join('');
    const pl = diff.newPlaces.map(k => `<li>${esc(Geo.placeName(k))} 初訪問 +${k.startsWith('jp:') ? P.pref : P.country}pt</li>`).join('');
    sheet(`<div class="celebrate">
      <div class="stampmark">${diff.newRegions.length ? '制覇' : '初訪問'}</div>
      <h2>+${diff.gained}pt</h2>
      <ul>${reg}${pl}</ul>
      ${diff.newRegions.length ? '<p class="muted" style="margin:0;font-size:13px">制覇記念の思い出ムービーは、次のアップデートで作れるようになります。</p>' : ''}
      <button class="btn primary" data-ok>旅帳を閉じる</button></div>`, (el, close) => { el.querySelector('[data-ok]').onclick = close; });
    return true;
  }

  /* ================= STATS ================= */
  function renderStats() {
    const v = $('#view'); v.className = 'view';
    const c = state.calc, P = Geo.POINTS;
    const regCard = (r, suffix = '') => `<div class="reg ${r.done ? 'done' : ''}"><b>${esc(r.name)}${suffix}</b><span class="mono">${r.got}/${r.total}</span>${r.done ? '<span class="done-mark">制覇</span>' : ''}<div class="bar"><i style="width:${r.total ? r.got / r.total * 100 : 0}%"></i></div><span class="muted" style="font-size:12px;grid-column:1/-1">制覇ボーナス ${r.bonus}pt</span></div>`;
    const conts = Geo.UN_REGIONS.map(([cont]) => cont);
    v.innerHTML = `<div class="stack">
      <div class="list-head"><div><div class="eyebrow">Achievements</div><h2>実績</h2></div></div>
      <div class="score tape"><div><div class="eyebrow">合計</div><div class="big">${c.points.toLocaleString()}<small style="font-size:16px">pt</small></div></div>
        <dl><dt>都道府県 ${c.jpCount}/47</dt><dd>${c.jpCount * P.pref}pt</dd><dt>国・地域 ${c.wCount}</dt><dd>${c.wCount * P.country}pt</dd><dt>制覇ボーナス</dt><dd>${c.bonus}pt</dd></dl></div>
      <p class="muted" style="margin:0;font-size:13px">都道府県の初訪問 +${P.pref}pt、国の初訪問 +${P.country}pt。地方をすべて訪れると「構成数×${P.bonusPer}pt」のボーナス。世界の地方は国連の地域区分で、独立国（＋台湾）が対象です。</p>
      <div><div class="section-title"><h3>日本の地方</h3><span class="mono muted">${c.jpRegions.filter(r => r.done).length}/8 制覇</span></div>
        <div class="regions">${c.jpRegions.map(r => regCard(r, '地方')).join('')}</div></div>
      ${conts.map(cont => { const rs = c.worldRegions.filter(r => r.continent === cont); return `<div><div class="section-title"><h3>${cont}</h3><span class="mono muted">${rs.reduce((s, r) => s + r.got, 0)}/${rs.reduce((s, r) => s + r.total, 0)}か国</span></div><div class="regions">${rs.map(r => regCard(r)).join('')}</div></div>`; }).join('')}
    </div>`;
  }

  /* ================= SETTINGS ================= */
  async function renderSettings() {
    const v = $('#view'); v.className = 'view';
    let est = '';
    try { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1)}MB 使用中`; } catch (e) { }
    const last = Store.settings.lastExport ? new Date(Store.settings.lastExport).toLocaleDateString('ja-JP') : 'まだありません';
    const hasSample = Store.trips.some(t => t.sample);
    v.innerHTML = `<div class="stack">
      <div class="list-head"><div><div class="eyebrow">Settings</div><h2>設定</h2></div></div>
      <div class="card"><label class="field">旅帳の名前<input id="s-name" value="${esc(Store.settings.bookName)}" placeholder="例：こうじ & ゆり の旅帳"></label></div>
      <div class="card">
        <h3>ZIPで共有・バックアップ</h3>
        <p class="muted">旅・写真・表紙の設定をまとめて1つのZIPにします。相手が「ZIPを読み込む」と、旅帳と地図に反映されます。</p>
        <p class="mono" style="font-size:13px">旅 ${Store.trips.length}件 / 写真 ${Store.photos.length}枚 / 最後の書き出し：${last}</p>
        <div class="progress" id="zipProg" hidden><i></i></div>
        <div class="row"><button class="btn primary" id="s-export">ZIPを書き出す</button><button class="btn" id="s-import">ZIPを読み込む</button></div>
      </div>
      <div class="card">
        <h3>保存場所</h3>
        <p class="muted">データはこの端末のブラウザ内（IndexedDB）に保存されます。サーバーには送られません。${est ? '<br>' + est : ''}<br>長期保存の許可：${Store.settings.persisted ? '<b style="color:var(--ok)">許可済み</b>' : '未許可（初回保存時に申請します）'}</p>
        <p class="muted">iPhoneはSafariの共有ボタン →「ホーム画面に追加」でアプリとして使えます。</p>
      </div>
      <div class="card">
        <h3>サンプルデータ</h3>
        <p class="muted">${hasSample ? 'サンプルの旅が入っています。自分の旅を入れる前に削除できます。' : '動作を試すためのサンプルの旅（5件）を入れられます。'}</p>
        <div class="row">${hasSample ? '<button class="btn stamp" id="s-unsample">サンプルを削除</button>' : '<button class="btn" id="s-sample">サンプルを入れる</button>'}</div>
      </div>
      <div class="card" id="wipe"><h3>すべて削除</h3><p class="muted">この端末のTABRIOGUのデータをすべて消します。先にZIPで書き出しておいてください。</p><div class="row"><button class="btn stamp small" id="s-wipe">すべて削除…</button></div></div>
      <p class="muted mono" style="font-size:11px;text-align:center">TABRIOGU v0.1 · 地図データ: 国土数値情報(dataofjapan/land), Natural Earth</p>
    </div>`;
    $('#s-name').onchange = async e => { Store.settings.bookName = e.target.value.trim() || 'ふたりの旅帳'; await Store.saveSettings(); $('#bookName').textContent = Store.settings.bookName; };
    $('#s-export').onclick = async () => {
      const bar = $('#zipProg'); bar.hidden = false;
      try {
        const blob = await Store.exportZip(p => { bar.firstElementChild.style.width = (p * 100) + '%'; });
        const d = new Date(); const fn = `tabriogu_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`;
        const ok = await saveFile(blob, fn);
        toast(ok ? `${fn} を書き出しました（${(blob.size / 1048576).toFixed(1)}MB）` : '書き出しをキャンセルしました');
      } catch (e) { toast('書き出しに失敗しました：' + e.message); }
      renderSettings();
    };
    $('#s-import').onclick = async () => {
      const [f] = await filePick('.zip,application/zip', false); if (!f) return;
      let pack; try { pack = await Store.readZip(f); } catch (e) { toast(e.message); return; }
      const d = pack.data;
      sheet(`<div class="stack"><h3>ZIPを読み込む</h3>
        <p class="mono" style="margin:0">「${esc(d.bookName || '')}」 旅 ${d.trips.length}件 / 写真 ${d.photos.length}枚<br><span class="muted">${new Date(d.exportedAt).toLocaleString('ja-JP')} 書き出し</span></p>
        <div class="radio-row">
          <label><input type="radio" name="im" value="merge" checked> 今の旅帳に追加する（同じ旅は新しい方を残す）</label>
          <label><input type="radio" name="im" value="replace"> 今の旅帳を置き換える（今のデータは消えます）</label>
        </div>
        <div class="progress" hidden id="imProg"><i></i></div>
        <button class="btn primary" data-go>読み込む</button></div>`, (el, close) => {
        el.querySelector('[data-go]').onclick = async (ev) => {
          ev.target.disabled = true;
          const mode = el.querySelector('input[name=im]:checked').value;
          const bar = el.querySelector('#imProg'); bar.hidden = false;
          const before = state.calc;
          try {
            const r = await Store.importZip(pack, mode, p => { bar.firstElementChild.style.width = (p * 100) + '%'; });
            recalc(); close(); refresh(); $('#bookName').textContent = Store.settings.bookName;
            toast(`旅 ${r.addedTrips}件追加・${r.updatedTrips}件更新、写真 ${r.addedPhotos}枚追加`);
            celebrate(Geo.diff(before, state.calc));
          } catch (e) { toast('読み込みに失敗しました：' + e.message); ev.target.disabled = false; }
        };
      });
    };
    const s1 = $('#s-sample'); if (s1) s1.onclick = loadSample;
    const s2 = $('#s-unsample'); if (s2) s2.onclick = async () => { for (const t of Store.trips.filter(t => t.sample)) await Store.deleteTrip(t.id); recalc(); refresh(); toast('サンプルを削除しました'); };
    $('#s-wipe').onclick = () => {
      $('#wipe .row').innerHTML = '<button class="btn danger small" id="s-wipe2">本当にすべて削除する</button>';
      $('#s-wipe2').onclick = async () => { await Store.clearAll(); Store.settings.covers = {}; await Store.saveSettings(); recalc(); refresh(); toast('すべて削除しました'); };
    };
  }

  /* ================= SAMPLE DATA ================= */
  async function sampleImage(label, sub, hue) {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1200, 900);
    g.addColorStop(0, `hsl(${hue},55%,62%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},50%,38%)`);
    x.fillStyle = g; x.fillRect(0, 0, 1200, 900);
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 9; i++) { x.beginPath(); x.arc((i * 173) % 1200, 300 + ((i * 97) % 500), 80 + (i * 31) % 160, 0, 7); x.fill(); }
    x.fillStyle = '#fff'; x.textAlign = 'center';
    x.font = '700 120px "Klee One", sans-serif'; x.fillText(label, 600, 470);
    x.font = '48px "Zen Kaku Gothic New", sans-serif'; x.fillText(sub, 600, 560);
    x.font = '700 32px monospace'; x.fillText('SAMPLE', 600, 840);
    const full = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
    const t = document.createElement('canvas'); t.width = 600; t.height = 450; t.getContext('2d').drawImage(c, 0, 0, 600, 450);
    const thumb = await new Promise(r => t.toBlob(r, 'image/jpeg', .8));
    return { full, thumb };
  }
  async function loadSample() {
    toast('サンプルを作成中…');
    const defs = [
      { title: '春の大阪・京都', status: 'done', startDate: '2025-03-20', endDate: '2025-03-22', memo: '海遊館のクラゲゾーンが最高だった。\n次は夜のチームラボ植物園へ。', photos: [['道頓堀', 'jp:27', 20], ['海遊館', 'jp:27', 200], ['嵐山', 'jp:26', 120], ['伏見稲荷', 'jp:26', 5]] },
      { title: '夏の四国一周', status: 'done', startDate: '2024-08-10', endDate: '2024-08-14', memo: 'レンタカーで4県をまわった。', photos: [['祖谷のかずら橋', 'jp:36', 140], ['うどん巡り', 'jp:37', 40], ['道後温泉', 'jp:38', 25], ['四万十川', 'jp:39', 170], ['桂浜', 'jp:39', 200]] },
      { title: '冬の金沢', status: 'done', startDate: '2024-12-07', endDate: '2024-12-08', memo: '', photos: [['兼六園', 'jp:17', 180], ['近江町市場', 'jp:17', 10]] },
      { title: '台北グルメ旅', status: 'done', startDate: '2025-01-11', endDate: '2025-01-13', memo: '小籠包と九份。', photos: [['九份', 'w:TW', 15], ['夜市', 'w:TW', 300]] },
      { title: 'パリのクリスマス', status: 'plan', startDate: '2026-12-22', endDate: '2026-12-27', memo: 'シャンゼリゼのイルミネーション、マルシェ・ド・ノエル。', places: ['w:FR'], photos: [] }
    ];
    const before = state.calc;
    for (const d of defs) {
      const t = Store.newTrip({ title: d.title, status: d.status, startDate: d.startDate, endDate: d.endDate, memo: d.memo, sample: true, places: d.places || [...new Set(d.photos.map(p => p[1]))] });
      const items = [];
      let i = 0;
      for (const [label, place, hue] of d.photos) {
        const img = await sampleImage(label, Geo.placeName(place), hue);
        const ts = new Date(d.startDate + 'T10:00:00').getTime() + i++ * 9 * 3600e3;
        items.push({ meta: { id: Store.uid('p'), tripId: t.id, takenAt: ts, lat: null, lng: null, place, caption: label, w: 1200, h: 900, createdAt: Date.now() }, full: img.full, thumb: img.thumb });
      }
      if (items.length) { await Store.addPhotos(items); t.coverPhotoId = items[0].meta.id; }
      await Store.saveTrip(t);
    }
    recalc(); refresh();
    celebrate(Geo.diff(before, state.calc));
  }

  /* ================= SHELL ================= */
  function go(tab) {
    state.tab = tab;
    try { history.replaceState(null, '', '#' + tab); } catch (e) { location.hash = tab; }
    document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    refresh();
  }
  function refresh() {
    if (state.tab === 'map') MapView.render();
    else if (state.tab === 'trips') renderTrips();
    else if (state.tab === 'stats') renderStats();
    else renderSettings();
  }
  function fabMenu() {
    sheet(`<div class="stack"><h3>旅帳に追加</h3>
      <button class="btn primary block" data-a="photos">${I.camera} 写真から旅をつくる</button>
      <button class="btn block" data-a="done">行った旅を記録する</button>
      <button class="btn block" data-a="plan">これからの旅を計画する</button>
      <p class="muted" style="font-size:12px;margin:0">写真を選ぶと、撮影日と位置情報から旅と都道府県・国を自動で振り分けます。</p></div>`, (el, close) => {
      el.querySelector('[data-a="photos"]').onclick = () => { close(); startImport(); };
      el.querySelector('[data-a="done"]').onclick = () => { close(); editTrip(Store.newTrip({ status: 'done' }), true); };
      el.querySelector('[data-a="plan"]').onclick = () => { close(); editTrip(Store.newTrip({ status: 'plan' }), true); };
    });
  }

  async function boot() {
    document.querySelector('.tabbar').innerHTML = `
      <button data-tab="map">${I.map}<span>地図</span></button>
      <button data-tab="trips">${I.book}<span>旅帳</span></button>
      <button class="fab" id="fab" aria-label="追加">${I.plus}</button>
      <button data-tab="stats">${I.medal}<span>実績</span></button>
      <button data-tab="prefs">${I.gear}<span>設定</span></button>`;
    document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
    $('#fab').onclick = fabMenu;
    $('#ptsBtn').onclick = () => go('stats');
    try {
      await Promise.all([Store.load(), Geo.load()]);
    } catch (e) {
      $('#view').innerHTML = `<div class="empty"><h3>読み込みに失敗しました</h3><p class="muted">${esc(e.message)}</p></div>`; return;
    }
    $('#bookName').textContent = Store.settings.bookName;
    recalc();
    const h = (location.hash || '').slice(1);
    go(['map', 'trips', 'stats', 'prefs'].includes(h) ? h : (Store.trips.length ? 'map' : 'trips'));
    window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t !== state.tab && ['map', 'trips', 'stats', 'prefs'].includes(t)) go(t); });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.tab === 'map') MapView.draw(); }, 200); });
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('claudeusercontent')) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }
  boot();
})();
