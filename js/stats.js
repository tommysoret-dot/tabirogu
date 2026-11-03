/* TABRIOGU — Phase 4: statistics, titles (称号), on-this-day */
(function () {
  const { Store, URLS, Geo, Photos } = TB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const R = 6371;
  const SEASONS = [['春', [3, 4, 5]], ['夏', [6, 7, 8]], ['秋', [9, 10, 11]], ['冬', [12, 1, 2]]];
  const centroid = new Map();
  const cen = (key) => { if (!centroid.has(key)) { const f = Geo.feature(key); centroid.set(key, f ? d3.geoCentroid(f) : null); } return centroid.get(key); };
  const km = (a, b) => (a && b) ? d3.geoDistance(a, b) * R : 0;
  const daysOf = t => t.startDate ? Math.round((new Date(t.endDate || t.startDate) - new Date(t.startDate)) / 864e5) + 1 : 0;

  /* ---------- statistics ---------- */
  function compute() {
    const calc = TB.UI.calc();
    const done = Store.trips.filter(t => t.status === 'done');
    const mem = Store.photos.filter(p => p.kind !== 'guide');
    const home = Store.settings.home || 'jp:13', hc = cen(home);
    const placesOf = t => { const s = new Set(t.places || []); mem.forEach(p => { if (p.tripId === t.id && p.place) s.add(p.place); }); return [...s]; };
    let distance = 0, farthest = null;
    done.forEach(t => {
      const ps = placesOf(t).filter(k => k !== home && k !== 'w:JP');
      let far = 0; ps.forEach(k => { const d = km(hc, cen(k)); if (d > far) far = d; if (!farthest || d > farthest.km) farthest = { key: k, km: d, trip: t }; });
      distance += far * 2; // round trip from home to the farthest place of each trip
    });
    const years = {}; done.forEach(t => { if (!t.startDate) return; const y = +t.startDate.slice(0, 4); years[y] = years[y] || { trips: 0, newPlaces: 0 }; years[y].trips++; });
    // first visit year for each place
    const firstYear = new Map();
    done.slice().sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')).forEach(t => {
      if (!t.startDate) return; const y = +t.startDate.slice(0, 4);
      placesOf(t).forEach(k => { if (k !== 'w:JP' && !firstYear.has(k)) { firstYear.set(k, y); if (years[y]) years[y].newPlaces++; } });
    });
    const seasons = SEASONS.map(([name, ms]) => ({ name, n: done.filter(t => t.startDate && ms.includes(+t.startDate.slice(5, 7))).length }));
    const top = [...calc.visited.entries()].filter(([k]) => k !== 'w:JP').map(([k, s]) => ({ key: k, n: s.size })).sort((a, b) => b.n - a.n || Geo.placeName(a.key).localeCompare(Geo.placeName(b.key), 'ja')).slice(0, 5);
    const ys = Object.keys(years).map(Number).sort();
    let streak = 0, best = 0; ys.forEach((y, i) => { streak = i && ys[i - 1] === y - 1 ? streak + 1 : 1; best = Math.max(best, streak); });
    const spots = Store.trips.reduce((s, t) => s + ((t.guide && t.guide.spots) || []).length, 0);
    const follow = done.map(t => { const sp = (t.guide && t.guide.spots) || []; return sp.length >= 5 ? sp.filter(s => s.result === 'went').length / sp.length : 0; });
    const countries = [...calc.visited.keys()].filter(k => k.startsWith('w:') && k !== 'w:JP').length;
    const continents = new Set([...calc.visited.keys()].filter(k => k.startsWith('w:')).map(k => (Geo.worldRegions.find(r => r.id === Geo.countryRegion[k.slice(2)]) || {}).continent).filter(Boolean)).size;
    return {
      calc, trips: done.length, plans: Store.trips.filter(t => t.status === 'plan').length,
      days: done.reduce((s, t) => s + daysOf(t), 0), maxDays: Math.max(0, ...done.map(daysOf)),
      photos: mem.filter(p => done.some(t => t.id === p.tripId)).length,
      distance, farthest, home, years, seasons, top, bestStreak: best, spots, bestFollow: Math.max(0, ...follow),
      countries, continents, jpRegionsDone: calc.jpRegions.filter(r => r.done).length, worldRegionsDone: calc.worldRegions.filter(r => r.done).length,
      movies: Object.keys(Store.settings.movies || {}).length,
      seasonsAll: seasons.every(s => s.n > 0), seasonsGot: seasons.filter(s => s.n > 0).length
    };
  }

  /* ---------- titles ---------- */
  const BADGES = [
    ['first', '👣', 'はじめの一歩', '最初の旅を記録する', s => [s.trips, 1]],
    ['trip10', '🧳', '旅好きふたり', '旅を10回記録する', s => [s.trips, 10]],
    ['trip30', '🗺️', '旅の達人', '旅を30回記録する', s => [s.trips, 30]],
    ['pref10', '🗾', '日本をめぐる', '10都道府県を訪れる', s => [s.calc.jpCount, 10]],
    ['pref24', '🎌', '日本の半分', '24都道府県を訪れる', s => [s.calc.jpCount, 24]],
    ['pref47', '🏯', '日本全国制覇', '47都道府県すべてを訪れる', s => [s.calc.jpCount, 47]],
    ['north', '🐻', '北の大地へ', '北海道を訪れる', s => [s.calc.visited.has('jp:1') ? 1 : 0, 1]],
    ['south', '🌺', '南の島へ', '沖縄県を訪れる', s => [s.calc.visited.has('jp:47') ? 1 : 0, 1]],
    ['region1', '🎖️', '地方制覇', '日本の地方を1つ制覇する', s => [s.jpRegionsDone, 1]],
    ['region4', '🏅', '地方コレクター', '日本の地方を4つ制覇する', s => [s.jpRegionsDone, 4]],
    ['abroad', '✈️', '海外デビュー', '日本以外の国を訪れる', s => [s.countries, 1]],
    ['country10', '🌍', '世界を歩く', '日本以外の10か国を訪れる', s => [s.countries, 10]],
    ['cont3', '🧭', '大陸ホッパー', '3つの大陸を訪れる（日本を含む）', s => [s.continents, 3]],
    ['cont5', '🌐', '五大陸制覇', '5つの大陸すべてを訪れる', s => [s.continents, 5]],
    ['long', '🛏️', 'のんびり連泊', '5日以上の旅をする', s => [s.maxDays, 5]],
    ['seasons', '🍁', '季節コンプリート', '春・夏・秋・冬それぞれに旅をする', s => [s.seasonsGot, 4]],
    ['streak3', '📅', '毎年恒例', '3年連続で旅をする', s => [s.bestStreak, 3]],
    ['photo500', '📷', 'ふたりのカメラマン', '思い出の写真を500枚貼る', s => [s.photos, 500]],
    ['guide50', '📖', 'しおり職人', 'しおりにスポットを50件登録する', s => [s.spots, 50]],
    ['follow', '✅', '有言実行', 'スポット5件以上のしおりで8割以上「行った」', s => [Math.round(s.bestFollow * 100), 80]],
    ['movie', '🎬', 'ムービー監督', '思い出ムービーを作る', s => [s.movies, 1]],
    ['far', '🛫', '遠くへ行きたい', '家から3,000km以上離れた場所を訪れる', s => [Math.round(s.farthest ? s.farthest.km : 0), 3000]]
  ];
  function badges(s) {
    return BADGES.map(([id, icon, name, cond, f]) => { const [v, goal] = f(s); return { id, icon, name, cond, v: Math.min(v, goal), goal, got: v >= goal, at: (Store.settings.badges || {})[id] }; });
  }
  /* call after data changes: records newly earned titles and tells the user */
  async function check(silent) {
    if (!Geo.jp) return;
    const s = compute(); const list = badges(s);
    const first = !Store.settings.badges;
    Store.settings.badges = Store.settings.badges || {};
    const fresh = list.filter(b => b.got && !Store.settings.badges[b.id]);
    if (!fresh.length) return;
    fresh.forEach(b => { Store.settings.badges[b.id] = Date.now(); });
    await Store.saveSettings();
    if (first || silent) return;
    setTimeout(() => TB.UI.toast(`称号「${fresh.map(b => b.icon + ' ' + b.name).join('」「')}」を獲得しました`), 600);
  }
  function currentTitle() {
    const got = badges(compute()).filter(b => b.got);
    return got.length ? got[got.length - 1] : null;
  }

  /* ---------- on this day ---------- */
  function onThisDay(today = new Date()) {
    const md = (d) => (d.getMonth() + 1) * 100 + d.getDate();
    const out = [];
    const done = Store.trips.filter(t => t.status === 'done' && t.startDate);
    const ty = today.getFullYear();
    done.forEach(t => {
      const sy = +t.startDate.slice(0, 4); if (sy >= ty) return;
      const yearsAgo = ty - sy;
      const same = new Date(today); same.setFullYear(sy);
      const sameStr = Photos.localDate(same.getTime());
      const exact = sameStr >= t.startDate && sameStr <= (t.endDate || t.startDate);
      const near = !exact && Math.abs(new Date(t.startDate + 'T12:00:00') - same) < 3.5 * 864e5;
      if (!exact && !near) return;
      const photos = Store.photos.filter(p => p.tripId === t.id && p.kind !== 'guide').sort((a, b) => Math.abs(md(new Date(a.takenAt)) - md(today)) - Math.abs(md(new Date(b.takenAt)) - md(today))).slice(0, 6);
      out.push({ trip: t, yearsAgo, exact, photos, date: sameStr });
    });
    return out.sort((a, b) => b.exact - a.exact || a.yearsAgo - b.yearsAgo);
  }
  function otdCard(list) {
    if (!list.length) return '';
    const m = list[0];
    return `<button class="otd tape" data-otd="${m.trip.id}">
      <div class="otd-head"><span class="otd-badge">${m.yearsAgo}年前の${m.exact ? '今日' : '今ごろ'}</span><span class="mono muted">${m.date.replace(/-/g, '.')}</span></div>
      <b class="otd-title">${esc(m.trip.title || '無題の旅')}</b>
      ${m.photos.length ? `<div class="otd-strip">${m.photos.map(p => `<i data-img="${p.id}"></i>`).join('')}</div>` : ''}
      ${list.length > 1 ? `<span class="muted" style="font-size:12px">ほか${list.length - 1}件の思い出</span>` : ''}</button>`;
  }
  async function fill(root) { for (const el of root.querySelectorAll('[data-img]')) { const u = await URLS.get(el.dataset.img); if (u) el.style.backgroundImage = `url(${u})`; } }
  async function maybeShowOnLaunch() {
    const today = Photos.localDate(Date.now());
    if (Store.settings.lastOTD === today) return;
    const list = onThisDay(); if (!list.length) return;
    Store.settings.lastOTD = today; await Store.saveSettings();
    TB.UI.sheet(`<div class="stack"><div class="eyebrow">On this day</div>${otdCard(list)}<button class="btn primary" data-ok>あとで見る</button></div>`, async (el, close) => {
      await fill(el);
      el.querySelector('[data-ok]').onclick = close;
      el.querySelector('[data-otd]').onclick = () => { close(); TB.UI.openTrip(list[0].trip.id, 'photos'); };
    });
  }

  /* ---------- rendering in the 実績 tab ---------- */
  function yearChart(years) {
    const ys = Object.keys(years).map(Number).sort(); if (!ys.length) return '<p class="muted">日付の入った旅がまだありません。</p>';
    const all = []; for (let y = ys[0]; y <= Math.max(ys[ys.length - 1], new Date().getFullYear()); y++) all.push(y);
    const show = all.slice(-8), max = Math.max(1, ...show.map(y => (years[y] || {}).trips || 0));
    const bw = 34, gap = 14, h = 120, W = show.length * (bw + gap) + gap;
    return `<div class="chart-scroll"><svg viewBox="0 0 ${W} ${h + 40}" width="${W}" height="${h + 40}" role="img" aria-label="年ごとの旅の回数">
      <line x1="0" x2="${W}" y1="${h}" y2="${h}" stroke="var(--line)"/>
      ${show.map((y, i) => { const v = (years[y] || {}).trips || 0, bh = v / max * (h - 24), x = gap + i * (bw + gap); const np = (years[y] || {}).newPlaces || 0;
        return `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="3" fill="var(--ink)" opacity="${y === new Date().getFullYear() ? .55 : .9}"/>
        ${v ? `<text x="${x + bw / 2}" y="${h - bh - 6}" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--font-mono)" font-weight="700">${v}</text>` : ''}
        <text x="${x + bw / 2}" y="${h + 16}" text-anchor="middle" font-size="11" fill="var(--ink-soft)" font-family="var(--font-mono)">${y}</text>
        ${np ? `<text x="${x + bw / 2}" y="${h + 32}" text-anchor="middle" font-size="10" fill="var(--stamp)">+${np}</text>` : ''}`; }).join('')}
    </svg></div><p class="muted" style="margin:4px 0 0;font-size:12px">棒は旅の回数、赤い数字はその年に初めて訪れた都道府県・国の数</p>`;
  }
  async function render(box) {
    const s = compute(), list = badges(s), got = list.filter(b => b.got).length;
    const maxSeason = Math.max(1, ...s.seasons.map(x => x.n));
    box.innerHTML = `
      <div><div class="section-title"><h3>ふたりの旅の記録</h3><span class="mono muted">${esc(Geo.placeName(s.home))}から</span></div>
        <div class="kpis">
          <div><b class="mono">${s.trips}</b><span>旅の回数</span></div>
          <div><b class="mono">${s.days}</b><span>旅した日数</span></div>
          <div><b class="mono">${s.photos.toLocaleString()}</b><span>思い出の写真</span></div>
          <div><b class="mono">${Math.round(s.distance).toLocaleString()}<small>km</small></b><span>移動距離（概算）</span></div>
        </div>
        ${s.farthest ? `<p style="margin:10px 0 0;font-size:14px">いちばん遠くへ行ったのは <b>${esc(Geo.placeName(s.farthest.key))}</b>（約${Math.round(s.farthest.km).toLocaleString()}km・${esc(s.farthest.trip.title || '')}）</p>` : ''}
        <p class="muted" style="margin:4px 0 0;font-size:12px">移動距離は、出発地から各旅でいちばん遠い場所までの往復を直線で足した概算です。出発地は設定で変えられます。</p></div>
      <div><div class="section-title"><h3>年ごとの旅</h3>${s.bestStreak > 1 ? `<span class="mono muted">最長${s.bestStreak}年連続</span>` : ''}</div>${yearChart(s.years)}</div>
      <div class="two-col">
        <div><div class="section-title"><h3>季節</h3></div>
          <div class="seasons">${s.seasons.map(x => `<div><span>${x.name}</span><i style="--w:${x.n / maxSeason * 100}%"></i><b class="mono">${x.n}</b></div>`).join('')}</div></div>
        <div><div class="section-title"><h3>よく行く場所</h3></div>
          ${s.top.length ? `<ol class="top5">${s.top.map(x => `<li><span>${esc(Geo.placeName(x.key))}</span><b class="mono">${x.n}回</b></li>`).join('')}</ol>` : '<p class="muted">まだありません</p>'}</div>
      </div>
      <div><div class="section-title"><h3>称号</h3><span class="mono muted">${got}/${list.length}</span></div>
        <div class="badges">${list.map(b => `<div class="badge-card ${b.got ? 'got' : ''}" title="${esc(b.cond)}">
          <span class="b-icon" aria-hidden="true">${b.icon}</span><b>${esc(b.name)}</b><span class="b-cond">${esc(b.cond)}</span>
          ${b.got ? `<span class="b-date mono">${b.at ? new Date(b.at).toLocaleDateString('ja-JP') : ''}</span>` : `<span class="b-prog"><i style="width:${b.v / b.goal * 100}%"></i></span><span class="b-date mono">${b.v.toLocaleString()} / ${b.goal.toLocaleString()}</span>`}
        </div>`).join('')}</div></div>`;
  }

  TB.Stats = { compute, badges, check, currentTitle, onThisDay, otdCard, fill, maybeShowOnLaunch, render };
})();
