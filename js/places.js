/* TABIROGU — spot search with free open data (OpenStreetMap Nominatim/Overpass + Wikipedia/Wikidata),
   spot map (Leaflet + OSM tiles) and automatic itinerary. No API key needed. */
(function () {
  const { Store, Geo, Photos } = TB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOMI = 'https://nominatim.openstreetmap.org';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const R = 6371;
  const kmBetween = (a, b) => d3.geoDistance([a.lng, a.lat], [b.lng, b.lat]) * R;
  const fmtKm = k => k < 1 ? Math.round(k * 1000) + 'm' : k.toFixed(k < 10 ? 1 : 0) + 'km';

  /* ---------- categories ---------- */
  const CATS = [
    { id: 'sight', label: '観光', icon: '👀', pill: '👀 みる', title: '観光スポット' },
    { id: 'food', label: 'グルメ', icon: '🍴', pill: '🍴 たべる', title: 'グルメ' },
    { id: 'cafe', label: 'カフェ・甘味', icon: '☕', pill: '☕ カフェ', title: 'カフェ & スイーツ' },
    { id: 'relax', label: '温泉・癒し', icon: '♨', pill: '♨ くつろぐ', title: '温泉 & 癒し' },
    { id: 'shop', label: '買い物', icon: '🛍', pill: '🛍 かう', title: 'お買いもの' },
    { id: 'stay', label: '宿', icon: '🏨', pill: '🏨 泊まる', title: '宿' }
  ];
  const catById = id => CATS.find(c => c.id === id) || CATS[0];
  function classify(cls, type, tags = {}) {
    const t = type || '';
    if (cls === 'tourism' && /^(hotel|hostel|guest_house|motel|apartment|ryokan|chalet|camp_site)$/.test(t)) return 'stay';
    if (cls === 'amenity' && /^(restaurant|fast_food|food_court|pub|bar|izakaya|biergarten)$/.test(t)) return 'food';
    if ((cls === 'amenity' && /^(cafe|ice_cream)$/.test(t)) || (cls === 'shop' && /^(bakery|confectionery|pastry|tea|coffee|chocolate)$/.test(t))) return 'cafe';
    if ((cls === 'amenity' && /^(public_bath|spa)$/.test(t)) || (cls === 'natural' && t === 'hot_spring') || (cls === 'leisure' && /^(spa|sauna)$/.test(t)) || tags['bath:type'] === 'onsen') return 'relax';
    if (cls === 'shop' && t === 'ticket') return 'sight';
    if (cls === 'shop' || (cls === 'amenity' && t === 'marketplace')) return 'shop';
    return 'sight';
  }
  const TYPE_JA = { attraction: '観光名所', museum: '博物館・美術館', viewpoint: '展望スポット', gallery: 'ギャラリー', zoo: '動物園', aquarium: '水族館', theme_park: 'テーマパーク', castle: '城', monument: '記念碑', memorial: '記念碑', ruins: '史跡', archaeological_site: '遺跡', place_of_worship: '寺社', shrine: '神社', temple: '寺', park: '公園', garden: '庭園', restaurant: 'レストラン', fast_food: 'ファストフード', food_court: 'フードコート', cafe: 'カフェ', ice_cream: 'アイス', bakery: 'パン屋', confectionery: '和洋菓子', pastry: 'スイーツ', public_bath: '温泉・銭湯', hot_spring: '温泉', spa: 'スパ', marketplace: '市場', mall: 'ショッピングモール', department_store: '百貨店', gift: 'おみやげ', hotel: 'ホテル', ryokan: '旅館', guest_house: 'ゲストハウス', hostel: 'ホステル', station: '駅', beach: 'ビーチ', peak: '山', waterfall: '滝', bridge: '橋' };
  const CUISINE_JA = { ramen: 'ラーメン', sushi: '寿司', udon: 'うどん', soba: 'そば', japanese: '和食', yakiniku: '焼肉', yakitori: '焼き鳥', okonomiyaki: 'お好み焼き', takoyaki: 'たこ焼き', curry: 'カレー', italian: 'イタリアン', french: 'フレンチ', chinese: '中華', korean: '韓国料理', burger: 'バーガー', pizza: 'ピザ', coffee_shop: 'コーヒー', cake: 'ケーキ', seafood: '海鮮', tempura: '天ぷら', tonkatsu: 'とんかつ', kaiseki: '懐石', izakaya: '居酒屋', donburi: '丼', gyudon: '牛丼', steak_house: 'ステーキ', bbq: 'BBQ', noodle: '麺', crepe: 'クレープ', ice_cream: 'アイス' };
  function hoursJa(h) {
    if (!h) return '';
    return h.replace(/\bMo\b/g, '月').replace(/\bTu\b/g, '火').replace(/\bWe\b/g, '水').replace(/\bTh\b/g, '木').replace(/\bFr\b/g, '金').replace(/\bSa\b/g, '土').replace(/\bSu\b/g, '日').replace(/\bPH\b/g, '祝').replace(/\boff\b/g, '休').replace(/;\s*/g, ' / ').replace(/-/g, '〜');
  }

  /* ---------- polite request queue for Nominatim (max 1 req/s) ---------- */
  let nomiLast = 0, nomiChain = Promise.resolve();
  function nomi(path) {
    const run = async () => {
      const wait = Math.max(0, nomiLast + 1100 - Date.now()); if (wait) await new Promise(r => setTimeout(r, wait));
      nomiLast = Date.now();
      const r = await fetch(NOMI + path, { headers: { 'Accept-Language': 'ja' } });
      if (!r.ok) throw new Error(r.status === 429 ? '検索が混み合っています。少し待ってからお試しください' : '検索に失敗しました（' + r.status + '）');
      return r.json();
    };
    const p = nomiChain.then(run, run); nomiChain = p.catch(() => { }); return p;
  }
  async function overpass(q) {
    let err;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (r.ok) return r.json();
        err = new Error('周辺検索に失敗しました（' + r.status + '）');
      } catch (e) { err = e; }
    }
    throw err || new Error('周辺検索に失敗しました');
  }

  /* ---------- normalized candidate ---------- */
  function fromNominatim(r) {
    const nd = r.namedetails || {}, ad = r.address || {}, ex = r.extratags || {};
    const name = nd['name:ja'] || nd.name || r.name || (r.display_name || '').split(',')[0];
    const cls = r.category || r.class, type = r.type;
    return {
      id: r.osm_type + '/' + r.osm_id, name, nameEn: nd['name:en'] || '', lat: +r.lat, lng: +r.lon,
      cat: classify(cls, type, ex), kind: TYPE_JA[type] || TYPE_JA[ex.tourism] || '', tags: ex,
      area: [ad.suburb || ad.city_district || ad.quarter || ad.town || ad.village, ad.city || ad.county].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / '),
      address: [ad.province || ad.state, ad.city, ad.suburb || ad.city_district, ad.quarter || ad.neighbourhood, ad.road].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(''),
      notable: !!(ex.wikipedia || ex.wikidata), importance: r.importance || 0
    };
  }
  function fromOverpass(e) {
    const tg = e.tags || {};
    const lat = e.lat ?? (e.center && e.center.lat), lng = e.lon ?? (e.center && e.center.lon);
    const keys = ['tourism', 'amenity', 'shop', 'historic', 'leisure', 'natural'];
    const cls = keys.find(k => tg[k]) || 'tourism';
    const type = tg[cls];
    const cuisine = (tg.cuisine || '').split(';').map(c => CUISINE_JA[c.trim()]).filter(Boolean).join('・');
    return {
      id: e.type + '/' + e.id, name: tg['name:ja'] || tg.name, nameEn: tg['name:en'] || '', lat, lng,
      cat: classify(cls, type, tg), kind: cuisine || TYPE_JA[type] || TYPE_JA[tg.historic] || '', tags: tg,
      area: [tg['addr:suburb'] || tg['addr:quarter'], tg['addr:city']].filter(Boolean).join(' / '),
      address: [tg['addr:province'], tg['addr:city'], tg['addr:suburb'], tg['addr:quarter'], tg['addr:neighbourhood'], tg['addr:block_number'] && tg['addr:block_number'] + '-' + (tg['addr:housenumber'] || '')].filter(Boolean).join(''),
      notable: !!(tg.wikipedia || tg.wikidata), importance: 0
    };
  }

  /* ---------- search ---------- */
  function biasBox(center) {
    if (!center) return '';
    const d = 1.2; return `&viewbox=${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}`;
  }
  async function searchName(q, center) {
    const res = await nomi(`/search?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&limit=12&accept-language=ja&q=${encodeURIComponent(q)}${biasBox(center)}`);
    const list = res.map(fromNominatim).filter(c => c.name);
    if (center) list.forEach(c => { c.dist = kmBetween(center, c); });
    return dedupe(list);
  }
  const OQ = {
    sight: ['nwr[tourism~"^(attraction|museum|viewpoint|gallery|zoo|aquarium|theme_park)$"][name]', 'nwr[historic~"^(castle|monument|memorial|ruins|archaeological_site)$"][name]', 'nwr[amenity=place_of_worship][name][wikidata]', 'nwr[leisure~"^(park|garden)$"][name][wikidata]'],
    food: ['nwr[amenity~"^(restaurant|fast_food|food_court)$"][name]'],
    cafe: ['nwr[amenity~"^(cafe|ice_cream)$"][name]', 'nwr[shop~"^(bakery|confectionery|pastry)$"][name]'],
    relax: ['nwr[amenity=public_bath][name]', 'nwr[natural=hot_spring][name]', 'nwr[leisure~"^(spa|sauna)$"][name]'],
    shop: ['nwr[shop~"^(gift|mall|department_store|souvenir)$"][name]', 'nwr[amenity=marketplace][name]'],
    stay: ['nwr[tourism~"^(hotel|ryokan|guest_house|hostel)$"][name]']
  };
  async function searchNearby(cat, center, radiusKm) {
    const rad = Math.round(radiusKm * 1000);
    const q = `[out:json][timeout:25];(${OQ[cat].map(s => s.replace('nwr', `nwr(around:${rad},${center.lat},${center.lng})`) + ';').join('')});out center 150;`;
    const res = await overpass(q);
    const list = (res.elements || []).map(fromOverpass).filter(c => c.name && c.lat != null);
    list.forEach(c => { c.dist = kmBetween(center, c); c.cat = cat === 'sight' && c.cat !== 'sight' ? c.cat : cat; });
    list.sort((a, b) => (b.notable - a.notable) || (a.dist - b.dist));
    return dedupe(list).slice(0, 60);
  }
  function dedupe(list) { const seen = new Set(); return list.filter(c => { const k = c.name + '|' + Math.round(c.lat * 500) + '|' + Math.round(c.lng * 500); if (seen.has(k)) return false; seen.add(k); return true; }); }

  /* ---------- Wikipedia enrichment ---------- */
  async function wikiSummary(lang, title) {
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!r.ok) return null; const j = await r.json();
    if (j.type === 'disambiguation') return null;
    return { extract: j.extract || '', image: (j.thumbnail && j.thumbnail.source) || '', url: j.content_urls && j.content_urls.mobile && j.content_urls.mobile.page, coords: j.coordinates, lang };
  }
  async function wikiFor(c) {
    try {
      const tg = c.tags || {};
      let lang, title;
      if (tg.wikidata) {
        const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(tg.wikidata)}&props=sitelinks&sitefilter=jawiki|enwiki&format=json&origin=*`);
        const j = await r.json(); const sl = (j.entities && j.entities[tg.wikidata] && j.entities[tg.wikidata].sitelinks) || {};
        if (sl.jawiki) { lang = 'ja'; title = sl.jawiki.title; } else if (sl.enwiki) { lang = 'en'; title = sl.enwiki.title; }
      }
      if (!title && tg.wikipedia) { const m = /^(\w+):(.+)$/.exec(tg.wikipedia); if (m) { lang = m[1]; title = m[2]; } }
      if (title) return await wikiSummary(lang, title);
      if (c.cat === 'sight' || c.cat === 'relax') { // try the Japanese article with the same name, accept only when it is nearby
        const w = await wikiSummary('ja', c.name);
        if (w && w.coords && kmBetween(c, { lat: w.coords.lat, lng: w.coords.lon }) < 3) return w;
      }
    } catch (e) { }
    return null;
  }
  async function imageToPhoto(t, url, caption) {
    try {
      const r = await fetch(url); if (!r.ok) return null;
      const res = await Photos.resizeBlob(await r.blob());
      const meta = { id: Store.uid('p'), tripId: t.id, kind: 'guide', takenAt: Date.now(), lat: null, lng: null, place: null, caption, w: res.w, h: res.h, createdAt: Date.now() };
      await Store.addPhotos([{ meta, full: res.full, thumb: res.thumb }]);
      return meta.id;
    } catch (e) { return null; }
  }

  /* ---------- sections ---------- */
  function sectionFor(t, cat) {
    const c = catById(cat);
    const word = c.pill.split(' ')[1];
    let sec = t.guide.sections.find(s => s.pill.includes(word) || (cat === 'cafe' && /カフェ|甘味|スイーツ/.test(s.pill + s.title)));
    if (!sec && cat === 'cafe') sec = t.guide.sections.find(s => s.pill.includes('たべる'));
    if (!sec) { sec = { id: Store.uid('s'), pill: c.pill, title: c.title }; t.guide.sections.push(sec); }
    return sec.id;
  }

  /* ---------- add a candidate to the guide ---------- */
  async function addCandidate(t, c) {
    TB.Guide.ensure(t);
    if (t.guide.spots.some(s => s.osm === c.id || (s.name === c.name && s.lat && Math.abs(s.lat - c.lat) < .002))) return null;
    const tg = c.tags || {};
    const info = [];
    if (tg.opening_hours) info.push(['時間', hoursJa(tg.opening_hours)]);
    if (tg.fee === 'no') info.push(['料金', '無料']); else if (tg.charge) info.push(['料金', tg.charge]);
    if (c.address) info.push(['場所', c.address]);
    const site = tg.website || tg['contact:website'] || tg.url; if (site) info.push(['URL', site]);
    const tel = tg.phone || tg['contact:phone']; if (tel) info.push(['TEL', tel]);
    const tags = [c.kind && `${catById(c.cat).icon} ${c.kind}`, tg.fee === 'no' && '🆓 無料', tg.wheelchair === 'yes' && '♿ バリアフリー', /yes|only/.test(tg.takeaway || '') && '🥡 テイクアウト'].filter(Boolean);
    const spot = { id: Store.uid('sp'), sectionId: sectionFor(t, c.cat), name: c.name, nameEn: c.nameEn, area: c.area, label: '', desc: '', point: '', tags, info, photoId: null, place: Geo.locate(c.lat, c.lng) || '', result: null, memo: '', lat: c.lat, lng: c.lng, osm: c.id, cat: c.cat, credit: '' };
    t.guide.spots.push(spot);
    if (spot.place && !(t.places || []).includes(spot.place)) t.places = [...(t.places || []), spot.place];
    await Store.saveTrip(t);
    // enrich in the background: Wikipedia text & photo, area name
    (async () => {
      const w = await wikiFor(c);
      if (w) {
        if (w.extract) spot.desc = w.extract.length > 180 ? w.extract.slice(0, 178).replace(/[^。]*$/, '') || w.extract.slice(0, 178) + '…' : w.extract;
        if (w.image) { spot.photoId = await imageToPhoto(t, w.image, spot.name); if (spot.photoId) spot.credit = '写真・紹介文: Wikipedia'; else spot.credit = '紹介文: Wikipedia'; }
        else spot.credit = '紹介文: Wikipedia';
      }
      if (!spot.area) { try { const r = await nomi(`/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=ja&lat=${c.lat}&lon=${c.lng}`); const ad = r.address || {}; spot.area = [ad.suburb || ad.city_district || ad.quarter || ad.town || ad.village, ad.city || ad.county].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / '); } catch (e) { } }
      await Store.saveTrip(t);
      onEnriched.forEach(f => f(t, spot));
    })();
    return spot;
  }
  const onEnriched = new Set();

  /* ---------- Leaflet (loaded on demand) ---------- */
  let leafletP = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => res(window.L); s.onerror = () => { leafletP = null; rej(new Error('地図を読み込めませんでした（オフラインの可能性があります）')); };
      document.head.appendChild(s);
    });
    return leafletP;
  }
  function baseMap(L, el, center, zoom) {
    const m = L.map(el, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], zoom || 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(m);
    return m;
  }
  const COLORS = { sight: '#22304a', food: '#c2452d', cafe: '#a0703a', relax: '#3f7a8f', shop: '#7a5aa0', stay: '#3f7a4f' };
  const pin = (L, n, cat, faded) => L.divIcon({ className: 'spot-pin', html: `<span style="background:${COLORS[cat] || '#22304a'};${faded ? 'opacity:.45' : ''}"><b>${n}</b></span>`, iconSize: [28, 28], iconAnchor: [14, 28] });

  function tripCenter(t) {
    const pts = ((t.guide && t.guide.spots) || []).filter(s => s.lat);
    if (pts.length) return { lat: d3.mean(pts, s => s.lat), lng: d3.mean(pts, s => s.lng) };
    const k = (t.places || []).find(Boolean);
    if (k) { const f = Geo.feature(k); if (f) { const [lng, lat] = d3.geoCentroid(f); return { lat, lng }; } }
    return null;
  }

  /* guide tab: map of the spots */
  async function mountGuideMap(t, box, onOpen) {
    const spots = t.guide.spots.filter(s => s.lat);
    const missing = t.guide.spots.length - spots.length;
    box.innerHTML = `<div class="gmap" ${spots.length ? '' : 'hidden'}></div>
      <div class="row gmap-bar">${spots.length ? `<span class="muted" style="font-size:12px">${spots.length}件を地図に表示</span>` : ''}
        ${missing ? `<button class="btn small" data-geo>📍 残り${missing}件を地図にのせる</button>` : ''}</div>`;
    const g = box.querySelector('[data-geo]');
    if (g) g.onclick = async () => {
      g.disabled = true;
      let done = 0, ok = 0; const todo = t.guide.spots.filter(s => !s.lat);
      const center = tripCenter(t);
      for (const s of todo) {
        g.textContent = `位置を調べています… ${++done}/${todo.length}`;
        try {
          const q = [s.name, (s.area || '').split('/')[0]].join(' ').trim();
          const res = await nomi(`/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(q)}${biasBox(center)}`);
          const r = res[0] || (await nomi(`/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(s.name)}${biasBox(center)}`))[0];
          if (r) { s.lat = +r.lat; s.lng = +r.lon; s.cat = s.cat || classify(r.category, r.type); ok++; }
        } catch (e) { }
      }
      await Store.saveTrip(t);
      TB.UI.toast(`${ok}件の位置がわかりました${todo.length - ok ? `（${todo.length - ok}件は見つかりませんでした）` : ''}`);
      mountGuideMap(t, box, onOpen);
    };
    if (!spots.length) return;
    let L; try { L = await loadLeaflet(); } catch (e) { box.querySelector('.gmap').outerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const el = box.querySelector('.gmap');
    const m = baseMap(L, el, spots[0], 13);
    const order = t.guide.sections.flatMap(sec => t.guide.spots.filter(s => s.sectionId === sec.id));
    const pts = [];
    spots.forEach(s => {
      const n = order.indexOf(s) + 1;
      const mk = L.marker([s.lat, s.lng], { icon: pin(L, n || '•', s.cat || 'sight', s.result === 'skip') }).addTo(m);
      mk.bindTooltip(esc(s.name), { direction: 'top', offset: [0, -26] });
      mk.on('click', () => onOpen(s));
      pts.push([s.lat, s.lng]);
    });
    if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30], maxZoom: 15 }); else m.setView(pts[0], 15);
    setTimeout(() => m.invalidateSize(), 50);
  }

  /* ---------- the spot finder page ---------- */
  function finder(t, rerender) {
    TB.Guide.ensure(t);
    const st = { mode: 'name', cat: 'sight', radius: 2, center: tripCenter(t), results: [], busy: false, added: 0 };
    const pg = TB.UI.page('スポットを探す', `
      <div class="seg" role="group" aria-label="探し方"><button data-mode="name">名前で探す</button><button data-mode="near">近くを探す</button></div>
      <div id="fd-ctrl"></div>
      <div class="fmap"></div>
      <div id="fd-list" class="cand-list"></div>
      <p class="muted" style="font-size:11px;margin:0">データ: © OpenStreetMap contributors（ODbL）、Wikipedia（CC BY-SA）。営業時間などは変わっていることがあるので、お出かけ前に公式情報をご確認ください。</p>`, async (el, close) => {
      const ctrl = el.querySelector('#fd-ctrl'), listEl = el.querySelector('#fd-list');
      let L = null, map = null, centerMk = null, layer = null;
      el.querySelector('[data-close]').addEventListener('click', () => { if (st.added) rerender(); }, { capture: true });
      try {
        L = await loadLeaflet();
        if (st.center) {
          map = baseMap(L, el.querySelector('.fmap'), st.center, 12);
          layer = L.layerGroup().addTo(map);
          centerMk = L.circleMarker([st.center.lat, st.center.lng], { radius: 8, color: '#c2452d', weight: 3, fillOpacity: .2 }).addTo(map);
          map.on('click', e => { st.center = { lat: e.latlng.lat, lng: e.latlng.lng }; centerMk.setLatLng(e.latlng); if (st.mode === 'near') { drawCtrl(); run(); } });
          setTimeout(() => map.invalidateSize(), 60);
        } else el.querySelector('.fmap').hidden = true;
      } catch (e) { el.querySelector('.fmap').hidden = true; }

      const drawCtrl = () => {
        el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === st.mode));
        if (st.mode === 'name') {
          ctrl.innerHTML = `<form id="fd-form" class="row" style="flex-wrap:nowrap"><input class="search" id="fd-q" placeholder="例：海遊館、道頓堀 たこ焼き" autocomplete="off" enterkeyhint="search"><button class="btn primary">検索</button></form>
            <p class="muted" style="margin:0;font-size:12px">${st.center ? '行き先の近くを優先して探します。' : '旅の行き先を設定すると、その近くを優先して探します。'}</p>`;
          ctrl.querySelector('#fd-form').onsubmit = e => { e.preventDefault(); run(); };
        } else {
          ctrl.innerHTML = `<div class="chips" id="fd-cats">${CATS.map(c => `<button class="chip" data-cat="${c.id}" aria-pressed="${st.cat === c.id}">${c.icon} ${c.label}</button>`).join('')}</div>
            <div class="row" style="font-size:13px"><span class="muted">範囲</span>${[1, 2, 5, 10].map(r => `<button class="chip" data-r="${r}" aria-pressed="${st.radius === r}">${r}km</button>`).join('')}
              <span style="flex:1"></span><button class="btn small" data-here>📍 現在地</button></div>
            <p class="muted" style="margin:0;font-size:12px">${st.center ? '地図をタップすると、そこを中心に探します。' : '中心がありません。「現在地」を押すか、名前で探して追加してください。'}</p>`;
          ctrl.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { st.cat = b.dataset.cat; drawCtrl(); run(); });
          ctrl.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { st.radius = +b.dataset.r; drawCtrl(); run(); });
          ctrl.querySelector('[data-here]').onclick = () => {
            if (!navigator.geolocation) return TB.UI.toast('この端末では現在地を使えません');
            navigator.geolocation.getCurrentPosition(p => {
              st.center = { lat: p.coords.latitude, lng: p.coords.longitude };
              if (map) { centerMk.setLatLng([st.center.lat, st.center.lng]); map.setView([st.center.lat, st.center.lng], 14); }
              drawCtrl(); run();
            }, () => TB.UI.toast('現在地を取得できませんでした（位置情報の許可を確認してください）'), { timeout: 10000 });
          };
        }
      };
      const draw = () => {
        if (st.busy) { listEl.innerHTML = '<p class="muted">探しています…</p>'; return; }
        if (!st.results.length) { listEl.innerHTML = st.searched ? '<p class="muted">見つかりませんでした。言葉を変えるか、範囲を広げてみてください。</p>' : ''; return; }
        const have = new Set(t.guide.spots.map(s => s.osm).filter(Boolean));
        listEl.innerHTML = st.results.map((c, i) => `<div class="cand">
            <span class="cand-ic" style="background:${COLORS[c.cat]}">${catById(c.cat).icon}</span>
            <div class="cand-b"><b>${esc(c.name)}</b><span class="muted">${esc([c.kind, c.area || c.address].filter(Boolean).join(' · '))}${c.dist != null ? ` · ${fmtKm(c.dist)}` : ''}</span>
              ${c.notable ? '<span class="cand-note">Wikipediaの紹介あり</span>' : ''}</div>
            <button class="cand-add ${have.has(c.id) ? 'on' : ''}" data-add="${i}" aria-label="${esc(c.name)}をしおりに追加">${have.has(c.id) ? '✓' : '＋'}</button></div>`).join('');
        listEl.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
          const c = st.results[+b.dataset.add];
          if (b.classList.contains('on')) return;
          b.classList.add('on'); b.textContent = '✓';
          const s = await addCandidate(t, c);
          if (s) { st.added++; TB.UI.toast(`「${c.name}」を${t.guide.sections.find(x => x.id === s.sectionId).pill}に追加しました`); }
        });
        if (map && layer) {
          layer.clearLayers();
          st.results.forEach((c, i) => L.marker([c.lat, c.lng], { icon: pin(L, i + 1, c.cat) }).addTo(layer).bindTooltip(esc(c.name), { direction: 'top', offset: [0, -26] }));
          const pts = st.results.map(c => [c.lat, c.lng]);
          if (pts.length) map.fitBounds(pts, { padding: [24, 24], maxZoom: 15 });
        }
      };
      const run = async () => {
        if (st.busy) return;
        try {
          if (st.mode === 'name') {
            const q = (el.querySelector('#fd-q') || {}).value; if (!q || !q.trim()) return;
            st.busy = true; draw(); st.results = await searchName(q.trim(), st.center);
          } else {
            if (!st.center) return;
            st.busy = true; draw(); st.results = await searchNearby(st.cat, st.center, st.radius);
          }
          st.searched = true;
        } catch (e) { TB.UI.toast(navigator.onLine === false ? 'オフラインのため探せません' : e.message); st.results = []; }
        st.busy = false; draw();
      };
      el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; st.results = []; st.searched = false; drawCtrl(); draw(); if (st.mode === 'near') run(); });
      drawCtrl();
      const q = el.querySelector('#fd-q'); if (q) q.focus();
    });
    return pg;
  }

  /* ---------- automatic itinerary ---------- */
  function autoItinerary(t, mode) {
    TB.Guide.ensure(t);
    const days = t.days, D = days.length;
    const pool = t.guide.spots.filter(s => s.result !== 'skip' && s.cat !== 'stay');
    const located = pool.filter(s => s.lat), unlocated = pool.filter(s => !s.lat);
    if (!pool.length) return { placed: 0, unlocated: 0 };
    // k-means on coordinates → one cluster per day
    let groups = [located];
    if (D > 1 && located.length > 1) {
      const k = Math.min(D, located.length);
      let cents = [located[0]];
      while (cents.length < k) { let best = null, bd = -1; located.forEach(s => { const d = Math.min(...cents.map(c => kmBetween(c, s))); if (d > bd) { bd = d; best = s; } }); cents.push(best); }
      cents = cents.map(c => ({ lat: c.lat, lng: c.lng }));
      for (let it = 0; it < 12; it++) {
        groups = cents.map(() => []);
        located.forEach(s => { let bi = 0; cents.forEach((c, i) => { if (kmBetween(c, s) < kmBetween(cents[bi], s)) bi = i; }); groups[bi].push(s); });
        cents = groups.map((g, i) => g.length ? { lat: d3.mean(g, s => s.lat), lng: d3.mean(g, s => s.lng) } : cents[i]);
      }
      // balance: move spots from crowded days to the nearest lighter day
      const cap = Math.ceil(located.length / k) + 1;
      groups.forEach((g, i) => { while (g.length > cap) { const s = g.pop(); let bj = -1, bd = 1e9; groups.forEach((h, j) => { if (j !== i && h.length < cap) { const d = kmBetween(cents[j], s); if (d < bd) { bd = d; bj = j; } } }); if (bj < 0) { g.push(s); break; } groups[bj].push(s); } });
      // order days west→east starting from the group closest to the first spot of the guide
      groups.sort((a, b) => (d3.mean(a, s => s.lng) || 0) - (d3.mean(b, s => s.lng) || 0));
    }
    while (groups.length < D) groups.push([]);
    unlocated.forEach((s, i) => groups[i % D].push(s));
    const toMin = h => h.split(':').reduce((a, b) => a * 60 + +b);
    const toHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    let placed = 0;
    days.forEach((day, di) => {
      const g = groups[di] || [];
      // nearest-neighbour route
      const sights = g.filter(s => !/food|cafe/.test(s.cat || '')), foods = g.filter(s => s.cat === 'food'), cafes = g.filter(s => s.cat === 'cafe');
      const route = []; const rest = sights.filter(s => s.lat); const noLoc = sights.filter(s => !s.lat);
      if (rest.length) { rest.sort((a, b) => a.lng - b.lng); let cur = rest.shift(); route.push(cur); while (rest.length) { rest.sort((a, b) => kmBetween(cur, a) - kmBetween(cur, b)); cur = rest.shift(); route.push(cur); } }
      route.push(...noLoc);
      const items = []; let tmin = toMin('10:00'), lunch = false, tea = false;
      route.forEach((s, i) => {
        if (!lunch && foods.length && tmin >= toMin('11:30')) { const at = Math.max(tmin, toMin('11:45')); items.push(mk(nearestTo(foods, s), toHM(at), 'ランチ')); tmin = at + 75; lunch = true; }
        if (!tea && cafes.length && tmin >= toMin('14:30')) { items.push(mk(nearestTo(cafes, s), toHM(tmin), 'ひと休み')); tmin += 45; tea = true; }
        const nx = route[i + 1];
        items.push(mk(s, toHM(tmin), nx && s.lat && nx.lat ? `次まで約${fmtKm(kmBetween(s, nx))}` : ''));
        const travel = nx && s.lat && nx.lat ? Math.min(60, Math.max(15, Math.round(kmBetween(s, nx) * 12 / 5) * 5)) : 20;
        tmin += (s.cat === 'relax' ? 120 : 90) + travel;
      });
      const last = route[route.length - 1];
      if (!lunch && foods.length) { const at = Math.max(tmin, toMin('12:00')); items.push(mk(nearestTo(foods, last), toHM(at), 'ランチ')); tmin = at + 75; }
      if (!tea && cafes.length) { const at = Math.max(tmin, toMin('15:00')); items.push(mk(nearestTo(cafes, last), toHM(at), 'ひと休み')); tmin = at + 45; }
      if (foods.length) { items.push(mk(nearestTo(foods, last), toHM(Math.max(tmin, toMin('18:30'))), 'ディナー')); }
      foods.forEach(f => items.push(mk(f, '16:30', '食べ歩き'))); foods.length = 0;
      cafes.forEach(f => items.push(mk(f, '16:00', ''))); cafes.length = 0;
      items.sort((a, b) => a.time.localeCompare(b.time));
      placed += items.length;
      const keep = mode === 'replace' ? day.items.filter(i => !i.spotId) : day.items;
      const existing = new Set(keep.map(i => i.spotId).filter(Boolean));
      day.items = [...keep, ...items.filter(i => !existing.has(i.spotId))].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    });
    function nearestTo(list, s) { let bi = 0; if (s && s.lat) list.forEach((f, i) => { if (f.lat && list[bi].lat && kmBetween(s, f) < kmBetween(s, list[bi])) bi = i; }); return list.splice(bi, 1)[0]; }
    function mk(s, time, note) { return { id: Store.uid('i'), time, title: '', spotId: s.id, note, done: null }; }
    return { placed, unlocated: unlocated.length };
  }

  TB.Places = { finder, mountGuideMap, autoItinerary, addCandidate, searchName, searchNearby, classify, hoursJa, onEnriched, CATS };
})();
