/* TABRIOGU — map data, regions, location lookup, conquest & points */
(function () {
  const JP_REGIONS = [
    { id: 'hokkaido', name: '北海道', prefs: [1] },
    { id: 'tohoku', name: '東北', prefs: [2, 3, 4, 5, 6, 7] },
    { id: 'kanto', name: '関東', prefs: [8, 9, 10, 11, 12, 13, 14] },
    { id: 'chubu', name: '中部', prefs: [15, 16, 17, 18, 19, 20, 21, 22, 23] },
    { id: 'kinki', name: '近畿', prefs: [24, 25, 26, 27, 28, 29, 30] },
    { id: 'chugoku', name: '中国', prefs: [31, 32, 33, 34, 35] },
    { id: 'shikoku', name: '四国', prefs: [36, 37, 38, 39] },
    { id: 'kyushu', name: '九州・沖縄', prefs: [40, 41, 42, 43, 44, 45, 46, 47] }
  ];
  const UN_REGIONS = [
    ['アジア', [['Eastern Asia', '東アジア'], ['South-Eastern Asia', '東南アジア'], ['Southern Asia', '南アジア'], ['Central Asia', '中央アジア'], ['Western Asia', '西アジア']]],
    ['ヨーロッパ', [['Northern Europe', '北ヨーロッパ'], ['Western Europe', '西ヨーロッパ'], ['Southern Europe', '南ヨーロッパ'], ['Eastern Europe', '東ヨーロッパ']]],
    ['アフリカ', [['Northern Africa', '北アフリカ'], ['Western Africa', '西アフリカ'], ['Middle Africa', '中部アフリカ'], ['Eastern Africa', '東アフリカ'], ['Southern Africa', '南部アフリカ']]],
    ['アメリカ', [['Northern America', '北アメリカ'], ['Central America', '中央アメリカ'], ['Caribbean', 'カリブ'], ['South America', '南アメリカ']]],
    ['オセアニア', [['Australia and New Zealand', 'オーストラリア・NZ'], ['Melanesia', 'メラネシア'], ['Micronesia', 'ミクロネシア'], ['Polynesia', 'ポリネシア']]]
  ];
  const POINTS = { pref: 10, country: 20, bonusPer: 10 };

  /* d3 expects clockwise exterior rings; fix polygons that came out inverted */
  function rewind(f) {
    const g = f.geometry; if (!g) return;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    polys.forEach(poly => {
      if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach(r => r.reverse());
    });
  }
  const Geo = {
    jp: null, world: null, // FeatureCollections
    prefName: {}, countryName: {}, countryRegion: {},
    worldRegions: [], // [{id,name,continent,members:[codes]}]
    async load() {
      const [j, w] = await Promise.all([fetch('data/japan.topo.json').then(r => r.json()), fetch('data/world.topo.json').then(r => r.json())]);
      this.jp = topojson.feature(j, j.objects.prefs);
      this.world = topojson.feature(w, w.objects.countries);
      [...this.jp.features, ...this.world.features].forEach(rewind);
      this.jp.features.forEach(f => { f.key = 'jp:' + f.properties.id; this.prefName[f.properties.id] = f.properties.name; });
      this.jp.features.sort((a, b) => a.properties.id - b.properties.id);
      this.world.features.forEach(f => { const p = f.properties; f.key = 'w:' + p.c; this.countryName[p.c] = p.n; this.countryRegion[p.c] = p.r; });
      this.worldRegions = [];
      UN_REGIONS.forEach(([cont, subs]) => subs.forEach(([id, name]) => {
        const members = this.world.features.filter(f => f.properties.r === id && (f.properties.i || f.properties.c === 'TW')).map(f => f.properties.c);
        this.worldRegions.push({ id, name, continent: cont, members });
      }));
      this.worldIndex = this.world.features.map(f => ({ f, b: d3.geoBounds(f) }));
    },
    JP_REGIONS, UN_REGIONS, POINTS,
    jpRegionOf(id) { return JP_REGIONS.find(r => r.prefs.includes(+id)); },
    placeName(key) {
      if (!key) return '場所未設定';
      const [t, c] = key.split(':');
      return t === 'jp' ? (this.prefName[c] || c) : (this.countryName[c] || c);
    },
    feature(key) {
      const [t, c] = key.split(':');
      return t === 'jp' ? this.jp.features.find(f => f.properties.id === +c) : this.world.features.find(f => f.properties.c === c);
    },
    /* lat/lng → place key */
    locate(lat, lng) {
      if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
      const pt = [lng, lat];
      const inJpBox = lng > 122 && lng < 154.5 && lat > 20 && lat < 46.5;
      if (inJpBox) {
        for (const f of this.jp.features) if (d3.geoContains(f, pt)) return f.key;
      }
      for (const { f, b } of this.worldIndex) {
        const [[x0, y0], [x1, y1]] = b;
        const inLng = x0 <= x1 ? (lng >= x0 - .1 && lng <= x1 + .1) : (lng >= x0 || lng <= x1);
        if (!inLng || lat < y0 - .1 || lat > y1 + .1) continue;
        if (d3.geoContains(f, pt)) return f.properties.c === 'JP' ? this.nearest(this.jp.features, pt, 1) || f.key : f.key;
      }
      // coast / small island: nearest feature within ~60km
      if (inJpBox) { const k = this.nearest(this.jp.features, pt, .012); if (k) return k; }
      return this.nearest(this.world.features, pt, .012);
    },
    nearest(features, pt, maxRad) {
      let best = null, bd = maxRad;
      for (const f of features) {
        const g = f.geometry; if (!g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length; i += 2) {
          const d = d3.geoDistance(pt, ring[i]);
          if (d < bd) { bd = d; best = f.key; }
        }
      }
      return best;
    },
    /* ---- visited / conquest / points ---- */
    compute(trips, photos) {
      const visited = new Map(); // key -> {tripIds:Set}
      const planned = new Set();
      const add = (k, tid) => { if (!visited.has(k)) visited.set(k, new Set()); visited.get(k).add(tid); };
      const done = new Map(trips.filter(t => t.status === 'done').map(t => [t.id, t]));
      trips.forEach(t => {
        (t.places || []).forEach(k => {
          if (t.status === 'done') { add(k, t.id); if (k.startsWith('jp:')) add('w:JP', t.id); }
          else planned.add(k);
        });
      });
      photos.forEach(p => {
        if (!p.place || !done.has(p.tripId)) return;
        add(p.place, p.tripId); if (p.place.startsWith('jp:')) add('w:JP', p.tripId);
      });
      if ([...planned].some(k => k.startsWith('jp:'))) planned.add('w:JP');
      const jpCount = [...visited.keys()].filter(k => k.startsWith('jp:')).length;
      const wCount = [...visited.keys()].filter(k => k.startsWith('w:')).length;
      const jpRegions = JP_REGIONS.map(r => {
        const got = r.prefs.filter(id => visited.has('jp:' + id)).length;
        return { ...r, got, total: r.prefs.length, done: got === r.prefs.length, bonus: r.prefs.length * POINTS.bonusPer };
      });
      const worldRegions = this.worldRegions.map(r => {
        const got = r.members.filter(c => visited.has('w:' + c)).length;
        return { ...r, got, total: r.members.length, done: r.members.length > 0 && got === r.members.length, bonus: r.members.length * POINTS.bonusPer };
      });
      const bonus = [...jpRegions, ...worldRegions].filter(r => r.done).reduce((s, r) => s + r.bonus, 0);
      const points = jpCount * POINTS.pref + wCount * POINTS.country + bonus;
      return { visited, planned, jpCount, wCount, jpRegions, worldRegions, bonus, points };
    },
    diff(before, after) {
      const newPlaces = [...after.visited.keys()].filter(k => !before.visited.has(k));
      const newRegions = [...after.jpRegions, ...after.worldRegions].filter(r => r.done && ![...before.jpRegions, ...before.worldRegions].find(b => b.id === r.id && b.done));
      return { newPlaces, newRegions, gained: after.points - before.points };
    }
  };
  TB.Geo = Geo;
})();
