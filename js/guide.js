/* TABRIOGU — しおり (guide): sections & spots, day itinerary, KOZYBOOK import */
(function () {
  const { Store, URLS, Geo, Photos } = TB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UI = () => TB.UI;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const INFO_KEYS = ['料金', 'アクセス', '時間', '場所', 'URL', 'TEL', '予約'];
  const PILL_COLORS = ['#d9a35a', '#6f93ae', '#8e7fb8', '#7fa77f', '#d98a6a', '#c27a8e'];

  function defaultSections() {
    return [
      { id: Store.uid('s'), pill: '✦ PICK UP', title: '今回の目玉' },
      { id: Store.uid('s'), pill: '👀 みる', title: '定番 & 話題のスポット' },
      { id: Store.uid('s'), pill: '🍴 たべる', title: 'グルメ' },
      { id: Store.uid('s'), pill: '♨ くつろぐ', title: '体験 & 癒し' }
    ];
  }
  function ensure(t) {
    if (!t.guide) t.guide = { subtitle: '', tags: [], sections: defaultSections(), spots: [] };
    if (!t.guide.sections || !t.guide.sections.length) t.guide.sections = defaultSections();
    t.guide.spots = t.guide.spots || [];
    ensureDays(t);
    return t;
  }
  function dateList(a, b) {
    if (!a) return [];
    const out = []; const d = new Date(a + 'T00:00:00'); const end = new Date((b || a) + 'T00:00:00');
    for (let i = 0; d <= end && i < 60; i++) { out.push(Photos.localDate(d.getTime())); d.setDate(d.getDate() + 1); }
    return out;
  }
  function ensureDays(t) {
    const dates = dateList(t.startDate, t.endDate);
    const old = t.days || [];
    if (!dates.length) { t.days = old.length ? old : [{ date: '', items: [] }]; return; }
    const byDate = new Map(old.filter(d => d.date).map(d => [d.date, d]));
    const orphan = old.filter(d => !d.date || !dates.includes(d.date)).flatMap(d => d.items || []);
    t.days = dates.map(date => byDate.get(date) || { date, items: [] });
    if (orphan.length) t.days[0].items.push(...orphan); // keep items when dates move
  }
  const dayLabel = (d, i) => d.date ? `${i + 1}日目 ${+d.date.slice(5, 7)}/${+d.date.slice(8)}(${WD[new Date(d.date + 'T00:00:00').getDay()]})` : `${i + 1}日目`;

  /* photo for a spot: memory photo linked to it (done trips), else its guide photo */
  function spotPhotoId(t, s) {
    const mem = Store.photos.filter(p => p.tripId === t.id && p.spotId === s.id && p.kind !== 'guide').sort((a, b) => a.takenAt - b.takenAt);
    if (t.status === 'done' && mem[0]) return mem[0].id;
    return s.photoId || (mem[0] && mem[0].id) || null;
  }
  async function fillImages(root) {
    for (const el of root.querySelectorAll('[data-img]')) {
      const u = await URLS.get(el.dataset.img); if (!u) continue;
      if (el.tagName === 'IMG') el.src = u; else el.style.backgroundImage = `url(${u})`;
    }
  }

  /* ================= しおり tab ================= */
  async function renderGuide(t, box, rerender) {
    ensure(t);
    const g = t.guide, done = t.status === 'done';
    const went = g.spots.filter(s => s.result === 'went').length;
    let html = `
      <div class="guide-cover">
        <div class="eyebrow">KOZYBOOK SERIES${t.startDate ? ' · ' + t.startDate.slice(0, 4) + ' EDITION' : ''}</div>
        <div class="guide-sub" ${g.subtitle ? '' : 'hidden'}>${esc(g.subtitle)}</div>
        <div class="chips">${(g.tags || []).map(x => `<span class="chip">${esc(x)}</span>`).join('')}
          <span class="chip">📍 スポット ${g.spots.length}</span>${done && g.spots.length ? `<span class="chip">✔ 行った ${went}/${g.spots.length}</span>` : ''}</div>
        <div class="row"><button class="btn small" data-gact="cover">表紙を編集</button><button class="btn small" data-gact="sections">セクション</button><button class="btn small" data-gact="kozy">KOZYBOOKから取り込む</button></div>
      </div>`;
    g.sections.forEach((sec, si) => {
      const spots = g.spots.filter(s => s.sectionId === sec.id);
      html += `<section class="gsec">
        <div class="gsec-head"><span class="pill" style="--pc:${PILL_COLORS[si % PILL_COLORS.length]}">${esc(sec.pill)}</span><h3>${esc(sec.title)}</h3><span class="mono muted">${spots.length}選</span></div>
        <div class="spots">${spots.map((s, i) => spotCard(t, s, i)).join('')}
          <button class="spot-add" data-addspot="${sec.id}">＋ スポットを追加</button></div></section>`;
    });
    const loose = g.spots.filter(s => !g.sections.find(x => x.id === s.sectionId));
    if (loose.length) html += `<section class="gsec"><div class="gsec-head"><span class="pill">その他</span></div><div class="spots">${loose.map((s, i) => spotCard(t, s, i)).join('')}</div></section>`;
    box.innerHTML = html;
    await fillImages(box);
    box.querySelectorAll('[data-spot]').forEach(b => b.onclick = (e) => { if (e.target.closest('[data-res]')) return; spotEditor(t, t.guide.spots.find(s => s.id === b.dataset.spot), rerender); });
    box.querySelectorAll('[data-addspot]').forEach(b => b.onclick = () => spotEditor(t, null, rerender, b.dataset.addspot));
    box.querySelectorAll('[data-res]').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const s = g.spots.find(x => x.id === b.dataset.sid); const v = b.dataset.res;
      s.result = s.result === v ? null : v;
      await Store.saveTrip(t); rerender();
    });
    box.querySelector('[data-gact="cover"]').onclick = () => coverEditor(t, rerender);
    box.querySelector('[data-gact="sections"]').onclick = () => sectionEditor(t, rerender);
    box.querySelector('[data-gact="kozy"]').onclick = async () => {
      const [f] = await UI().filePick('.html,.htm,text/html', false); if (!f) return;
      try { const n = await importIntoTrip(t, await f.text()); UI().toast(`${n}件のスポットを取り込みました`); rerender(); }
      catch (e) { UI().toast(e.message); }
    };
  }
  function spotCard(t, s, i) {
    const pid = spotPhotoId(t, s);
    const done = t.status === 'done';
    const info = (s.info || []).filter(([k, v]) => v).slice(0, 4);
    return `<article class="spot ${s.result === 'skip' ? 'skipped' : ''}" data-spot="${s.id}" tabindex="0">
      <div class="spot-photo" ${pid ? `data-img="${pid}"` : ''}>${s.label ? `<span class="spot-lbl">${esc(s.label)}</span>` : ''}<span class="spot-no mono">${String(i + 1).padStart(2, '0')}</span>
        ${s.result === 'went' ? '<span class="went-stamp">行った!</span>' : ''}</div>
      <div class="spot-body">
        ${s.area ? `<div class="spot-area">${esc(s.area)}</div>` : ''}
        <h4>${esc(s.name || '名前未設定')}</h4>
        ${s.nameEn ? `<div class="spot-en">${esc(s.nameEn)}</div>` : ''}
        ${s.desc ? `<p class="spot-desc">${esc(s.desc)}</p>` : ''}
        ${s.point ? `<div class="spot-point"><b>✔ ここがポイント！</b>${esc(s.point)}</div>` : ''}
        ${(s.tags || []).length ? `<div class="chips">${s.tags.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
        ${info.length ? `<dl class="spot-info">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        ${done && s.memo ? `<div class="spot-memo">${esc(s.memo)}</div>` : ''}
        ${done ? `<div class="res-row"><button data-res="went" data-sid="${s.id}" aria-pressed="${s.result === 'went'}">✔ 行った</button><button data-res="skip" data-sid="${s.id}" aria-pressed="${s.result === 'skip'}">行かなかった</button></div>` : ''}
      </div></article>`;
  }

  /* ---------- spot editor ---------- */
  function spotEditor(t, spot, rerender, sectionId) {
    const isNew = !spot;
    const s = spot ? JSON.parse(JSON.stringify(spot)) : { id: Store.uid('sp'), sectionId: sectionId || t.guide.sections[0].id, name: '', nameEn: '', area: '', label: '', desc: '', point: '', tags: [], info: [], photoId: null, place: '', result: null, memo: '' };
    const infoMap = new Map(s.info || []);
    const extraInfo = (s.info || []).filter(([k]) => !INFO_KEYS.includes(k));
    const tripPhotos = Store.photos.filter(p => p.tripId === t.id).sort((a, b) => a.takenAt - b.takenAt);
    UI().page(isNew ? 'スポットを追加' : 'スポットを編集', `
      <form id="spotForm" class="stack">
        <label class="field">名前<input id="sp-name" required value="${esc(s.name)}" placeholder="例：海遊館"></label>
        <div class="two"><label class="field">英語名など<input id="sp-en" value="${esc(s.nameEn)}" placeholder="Osaka Aquarium Kaiyukan"></label>
          <label class="field">エリア<input id="sp-area" value="${esc(s.area)}" placeholder="天保山 / 大阪港"></label></div>
        <div class="two"><label class="field">セクション<select id="sp-sec">${t.guide.sections.map(x => `<option value="${x.id}" ${x.id === s.sectionId ? 'selected' : ''}>${esc(x.pill)}</option>`).join('')}</select></label>
          <label class="field">ラベル<input id="sp-lbl" value="${esc(s.label)}" placeholder="人気No.1 / FREE"></label></div>
        <label class="field">紹介文<textarea id="sp-desc" rows="3" style="font-family:var(--font-body)">${esc(s.desc)}</textarea></label>
        <label class="field">ここがポイント！<input id="sp-point" value="${esc(s.point)}" placeholder="例：日没30分後〜が最も幻想的"></label>
        <label class="field">タグ（、区切り）<input id="sp-tags" value="${esc((s.tags || []).join('、'))}" placeholder="🌙 夜のみ、⏱ 約1.5時間"></label>
        <div class="field">情報<div class="info-grid">${INFO_KEYS.map(k => `<label>${k}<input data-info="${k}" value="${esc(infoMap.get(k) || '')}"></label>`).join('')}
          ${extraInfo.map(([k, v]) => `<label>${esc(k)}<input data-info="${esc(k)}" value="${esc(v)}"></label>`).join('')}</div></div>
        <div class="field">都道府県・国（地図に反映）<div class="chips" id="sp-place"></div></div>
        <div class="field">写真<div class="strip" id="sp-photos">
          <button type="button" class="strip-add" data-upload aria-label="写真を選ぶ">＋</button>
          ${tripPhotos.map(p => `<button type="button" data-pick="${p.id}" data-img="${p.id}" class="${p.id === s.photoId ? 'is-cover' : ''}"></button>`).join('')}</div></div>
        ${t.status === 'done' ? `<div class="field">結果<div class="seg" id="sp-res"><button type="button" data-r="went" aria-pressed="${s.result === 'went'}">行った</button><button type="button" data-r="skip" aria-pressed="${s.result === 'skip'}">行かなかった</button><button type="button" data-r="" aria-pressed="${!s.result}">未チェック</button></div></div>
        <label class="field">感想<textarea id="sp-memo" placeholder="実際に行ってみてどうだった？">${esc(s.memo)}</textarea></label>` : ''}
        <button class="btn primary block" type="submit">保存</button>
        ${isNew ? '' : '<div id="sp-del"><button type="button" class="btn stamp small" data-del>このスポットを削除</button></div>'}
      </form>`, async (el, close) => {
      await fillImages(el);
      const drawPlace = () => {
        el.querySelector('#sp-place').innerHTML = (s.place ? `<span class="chip">${esc(Geo.placeName(s.place))}<button type="button" data-rmp aria-label="外す">×</button></span>` : '') + '<button type="button" class="chip add" data-setp>＋ 選ぶ</button>';
        const rm = el.querySelector('[data-rmp]'); if (rm) rm.onclick = () => { s.place = ''; drawPlace(); };
        el.querySelector('[data-setp]').onclick = () => UI().picker(s.place ? [s.place] : (t.places || []).slice(0, 1), false, ([k]) => { s.place = k; drawPlace(); });
      };
      drawPlace();
      const bindPick = () => el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        s.photoId = s.photoId === b.dataset.pick ? null : b.dataset.pick;
        el.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('is-cover', x.dataset.pick === s.photoId));
      });
      bindPick();
      el.querySelector('[data-upload]').onclick = async () => {
        const [f] = await UI().filePick('image/*', false); if (!f) return;
        const r = await Photos.resizeBlob(f);
        const meta = { id: Store.uid('p'), tripId: t.id, kind: 'guide', takenAt: Date.now(), lat: null, lng: null, place: null, caption: s.name, w: r.w, h: r.h, createdAt: Date.now() };
        await Store.addPhotos([{ meta, full: r.full, thumb: r.thumb }]);
        s.photoId = meta.id;
        const b = document.createElement('button'); b.type = 'button'; b.dataset.pick = meta.id; b.dataset.img = meta.id; b.className = 'is-cover';
        el.querySelectorAll('[data-pick]').forEach(x => x.classList.remove('is-cover'));
        el.querySelector('#sp-photos').appendChild(b); await fillImages(el.querySelector('#sp-photos')); bindPick();
      };
      el.querySelectorAll('#sp-res [data-r]').forEach(b => b.onclick = () => { s.result = b.dataset.r || null; el.querySelectorAll('#sp-res [data-r]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        el.querySelector('#sp-del').innerHTML = '<button type="button" class="btn danger small" data-yes>削除する（旅程からも外れます）</button>';
        el.querySelector('[data-yes]').onclick = async () => {
          t.guide.spots = t.guide.spots.filter(x => x.id !== s.id);
          t.days.forEach(d => d.items.forEach(it => { if (it.spotId === s.id) it.spotId = null; }));
          await Store.saveTrip(t); close(); rerender();
        };
      };
      el.querySelector('#spotForm').onsubmit = async (e) => {
        e.preventDefault();
        const v = id => el.querySelector(id).value.trim();
        Object.assign(s, { name: v('#sp-name'), nameEn: v('#sp-en'), area: v('#sp-area'), sectionId: v('#sp-sec'), label: v('#sp-lbl'), desc: el.querySelector('#sp-desc').value.trim(), point: v('#sp-point'),
          tags: v('#sp-tags').split(/[、,]/).map(x => x.trim()).filter(Boolean),
          info: [...el.querySelectorAll('[data-info]')].map(i => [i.dataset.info, i.value.trim()]).filter(([, x]) => x) });
        const m = el.querySelector('#sp-memo'); if (m) s.memo = m.value;
        const before = TB.UI.calc();
        if (s.place && !(t.places || []).includes(s.place)) t.places = [...(t.places || []), s.place];
        const i = t.guide.spots.findIndex(x => x.id === s.id);
        if (i >= 0) t.guide.spots[i] = s; else t.guide.spots.push(s);
        await Store.saveTrip(t);
        UI().recalc(); close(); rerender();
        UI().celebrate(Geo.diff(before, TB.UI.calc()));
      };
    });
  }

  function coverEditor(t, rerender) {
    const g = t.guide;
    UI().sheet(`<form class="stack" id="cvForm"><h3>しおりの表紙</h3>
      <label class="field">サブタイトル<input id="cv-sub" value="${esc(g.subtitle)}" placeholder="例：〜大阪編〜 ふたりのデートガイド"></label>
      <label class="field">表紙タグ（、区切り）<input id="cv-tags" value="${esc((g.tags || []).join('、'))}" placeholder="📸 SNS映え、🆓 無料スポットあり"></label>
      <button class="btn primary">保存</button></form>`, (el, close) => {
      el.querySelector('#cvForm').onsubmit = async e => {
        e.preventDefault();
        g.subtitle = el.querySelector('#cv-sub').value.trim();
        g.tags = el.querySelector('#cv-tags').value.split(/[、,]/).map(x => x.trim()).filter(Boolean);
        await Store.saveTrip(t); close(); rerender();
      };
    });
  }
  function sectionEditor(t, rerender) {
    const secs = JSON.parse(JSON.stringify(t.guide.sections));
    UI().sheet(`<div class="stack"><h3>セクション</h3><p class="muted" style="margin:0;font-size:13px">見出し（絵文字＋短い名前）とタイトルを編集できます。スポットのあるセクションは削除できません。</p><div id="secList" class="stack" style="gap:10px"></div>
      <div class="row"><button class="btn small" data-addsec>＋ セクションを追加</button><span style="flex:1"></span><button class="btn primary" data-save>保存</button></div></div>`, (el, close) => {
      const draw = () => {
        el.querySelector('#secList').innerHTML = secs.map((s, i) => {
          const n = t.guide.spots.filter(x => x.sectionId === s.id).length;
          return `<div class="sec-row"><input data-p="${i}" value="${esc(s.pill)}" aria-label="見出し"><input data-t="${i}" value="${esc(s.title)}" aria-label="タイトル">
            <button class="icon-btn" data-up="${i}" aria-label="上へ" ${i ? '' : 'disabled'}>↑</button><button class="icon-btn" data-rm="${i}" aria-label="削除" ${n ? 'disabled' : ''}>×</button></div>`;
        }).join('');
        el.querySelectorAll('[data-p]').forEach(x => x.oninput = () => { secs[+x.dataset.p].pill = x.value; });
        el.querySelectorAll('[data-t]').forEach(x => x.oninput = () => { secs[+x.dataset.t].title = x.value; });
        el.querySelectorAll('[data-up]').forEach(x => x.onclick = () => { const i = +x.dataset.up; [secs[i - 1], secs[i]] = [secs[i], secs[i - 1]]; draw(); });
        el.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { secs.splice(+x.dataset.rm, 1); draw(); });
      };
      draw();
      el.querySelector('[data-addsec]').onclick = () => { secs.push({ id: Store.uid('s'), pill: '📌 新しい', title: '' }); draw(); };
      el.querySelector('[data-save]').onclick = async () => { t.guide.sections = secs.filter(s => s.pill.trim() || s.title.trim()); await Store.saveTrip(t); close(); rerender(); };
    });
  }

  /* ================= 旅程 tab ================= */
  function renderDays(t, box, rerender, dayIdx = 0) {
    ensure(t);
    const done = t.status === 'done';
    const idx = Math.min(dayIdx, t.days.length - 1);
    const day = t.days[idx];
    const spotOf = id => t.guide.spots.find(s => s.id === id);
    box.innerHTML = `
      ${t.startDate ? '' : '<div class="banner"><p>出発日と帰着日を入れると、日ごとの旅程に分かれます。</p></div>'}
      <div class="day-tabs" role="tablist">${t.days.map((d, i) => `<button role="tab" data-day="${i}" aria-selected="${i === idx}">${esc(dayLabel(d, i))}</button>`).join('')}</div>
      <ol class="timeline">${day.items.map((it, i) => {
      const sp = spotOf(it.spotId);
      return `<li class="${it.done === false ? 'skipped' : ''}">
          <span class="tl-time mono">${esc(it.time || '')}</span>
          <button class="tl-body" data-item="${i}">
            <b>${esc(it.title || (sp && sp.name) || '予定')}</b>
            ${sp ? `<span class="muted">📍 ${esc(sp.area ? sp.area + ' · ' : '')}${esc(sp.name)}</span>` : ''}
            ${it.note ? `<span class="tl-note">${esc(it.note)}</span>` : ''}
          </button>
          ${done ? `<button class="tl-check ${it.done ? 'on' : ''}" data-chk="${i}" aria-label="行った" aria-pressed="${!!it.done}">✔</button>` : ''}
        </li>`;
    }).join('')}</ol>
      ${day.items.length ? '' : `<p class="muted">この日の予定はまだありません。${t.guide.spots.length ? 'しおりのスポットから組み立てられます。' : ''}</p>`}
      <div class="row"><button class="btn primary small" data-add>＋ 予定を追加</button>${t.guide.spots.length ? '<button class="btn small" data-fromspot>スポットから追加</button>' : ''}</div>`;
    const again = () => renderDays(t, box, rerender, idx);
    box.querySelectorAll('[data-day]').forEach(b => b.onclick = () => renderDays(t, box, rerender, +b.dataset.day));
    box.querySelectorAll('[data-item]').forEach(b => b.onclick = () => itemEditor(t, idx, +b.dataset.item, again));
    box.querySelectorAll('[data-chk]').forEach(b => b.onclick = async () => {
      const it = day.items[+b.dataset.chk];
      it.done = it.done ? null : true;
      const sp = spotOf(it.spotId); if (sp && it.done) sp.result = 'went';
      await Store.saveTrip(t); again();
    });
    box.querySelector('[data-add]').onclick = () => itemEditor(t, idx, -1, again);
    const fs = box.querySelector('[data-fromspot]');
    if (fs) fs.onclick = () => UI().sheet(`<div class="stack"><h3>${esc(dayLabel(day, idx))}に追加</h3><div class="mini-trips">${t.guide.spots.map(s => `<button data-s="${s.id}"><span>${esc(s.name)}</span><span class="muted" style="font-size:12px">${esc(s.area || '')}</span></button>`).join('')}</div></div>`, (el, close) => {
      el.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => {
        day.items.push({ id: Store.uid('i'), time: nextTime(day), title: '', spotId: b.dataset.s, note: '', done: null });
        await Store.saveTrip(t); close(); again();
      });
    });
  }
  function nextTime(day) {
    const last = day.items.map(i => i.time).filter(Boolean).sort().pop();
    if (!last) return '10:00';
    const [h, m] = last.split(':').map(Number); const n = Math.min(23, h + 2);
    return String(n).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function itemEditor(t, di, ii, again) {
    const day = t.days[di];
    const it = ii >= 0 ? { ...day.items[ii] } : { id: Store.uid('i'), time: nextTime(day), title: '', spotId: null, note: '', done: null };
    UI().sheet(`<form class="stack" id="itForm"><h3>${ii >= 0 ? '予定を編集' : '予定を追加'}</h3>
      <div class="two"><label class="field">時刻<input type="time" id="it-time" value="${esc(it.time)}"></label>
        <label class="field">日<select id="it-day">${t.days.map((d, i) => `<option value="${i}" ${i === di ? 'selected' : ''}>${esc(dayLabel(d, i))}</option>`).join('')}</select></label></div>
      <label class="field">内容<input id="it-title" value="${esc(it.title)}" placeholder="例：新大阪駅着、ホテルにチェックイン"></label>
      <label class="field">スポット<select id="it-spot"><option value="">（なし）</option>${t.guide.spots.map(s => `<option value="${s.id}" ${s.id === it.spotId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="field">メモ・移動<input id="it-note" value="${esc(it.note)}" placeholder="例：御堂筋線で15分"></label>
      ${t.status === 'done' ? `<div class="seg" id="it-res"><button type="button" data-r="1" aria-pressed="${it.done === true}">行った</button><button type="button" data-r="0" aria-pressed="${it.done === false}">行かなかった</button><button type="button" data-r="" aria-pressed="${it.done == null}">未チェック</button></div>` : ''}
      <div class="row"><button class="btn primary">保存</button>${ii >= 0 ? '<button type="button" class="btn small" data-mv="-1">↑ 前へ</button><button type="button" class="btn small" data-mv="1">↓ 後へ</button><span style="flex:1"></span><button type="button" class="btn stamp small" data-del>削除</button>' : ''}</div></form>`, (el, close) => {
      el.querySelectorAll('#it-res [data-r]').forEach(b => b.onclick = () => { it.done = b.dataset.r === '' ? null : b.dataset.r === '1'; el.querySelectorAll('#it-res [data-r]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      el.querySelectorAll('[data-mv]').forEach(b => b.onclick = async () => {
        const j = ii + +b.dataset.mv; if (j < 0 || j >= day.items.length) return;
        [day.items[ii], day.items[j]] = [day.items[j], day.items[ii]]; await Store.saveTrip(t); close(); again();
      });
      const del = el.querySelector('[data-del]'); if (del) del.onclick = async () => { day.items.splice(ii, 1); await Store.saveTrip(t); close(); again(); };
      el.querySelector('#itForm').onsubmit = async e => {
        e.preventDefault();
        it.time = el.querySelector('#it-time').value; it.title = el.querySelector('#it-title').value.trim();
        it.spotId = el.querySelector('#it-spot').value || null; it.note = el.querySelector('#it-note').value.trim();
        const nd = +el.querySelector('#it-day').value;
        if (ii >= 0) day.items.splice(ii, 1);
        const target = t.days[nd]; target.items.push(it);
        target.items.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
        if (it.done && it.spotId) { const sp = t.guide.spots.find(s => s.id === it.spotId); if (sp) sp.result = 'went'; }
        await Store.saveTrip(t); close(); again();
      };
    });
  }

  /* ================= KOZYBOOK import ================= */
  function parseKozybook(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const txt = (el, sel) => { const x = sel ? el.querySelector(sel) : el; return x ? x.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const secs = [...doc.querySelectorAll('.sec')];
    if (!secs.length || !doc.querySelector('.cname')) throw new Error('KOZYBOOK形式のHTMLではないようです（スポットが見つかりません）');
    const out = {
      title: (doc.title || txt(doc, '.cover-title')).trim(),
      tags: [...doc.querySelectorAll('.cover-tag')].map(e => txt(e)).filter(Boolean),
      cover: (doc.querySelector('.cover-photo img') || {}).src || null,
      sections: []
    };
    secs.forEach(sec => {
      const s = { pill: txt(sec, '.sec-icon-pill'), title: txt(sec, '.sec-title'), spots: [] };
      let group = '';
      sec.querySelectorAll('.sub-label, .feat, .card').forEach(el => {
        if (el.closest('.sec') !== sec) return; // sections can be nested when the html is not closed
        if (el.classList.contains('sub-label')) { group = txt(el); return; }
        if (!el.querySelector('.cname')) return;
        const info = [];
        const itbl = el.querySelector('.itbl');
        if (itbl) {
          const ks = [...itbl.querySelectorAll('.ik')];
          ks.forEach(k => {
            const v = k.nextElementSibling; if (!v) return;
            const a = v.querySelector('a');
            info.push([txt(k), a && txt(k) === 'URL' ? a.getAttribute('href') : txt(v)]);
          });
        }
        const img = el.querySelector('.photo img');
        s.spots.push({
          name: txt(el, '.cname'), nameEn: txt(el, '.cname-en'), area: txt(el, '.atag'), label: txt(el, '.lbl'),
          desc: txt(el, '.cdesc'), point: txt(el, '.point').replace(/^✔?\s*ここがポイント！?\s*/, ''),
          tags: [...el.querySelectorAll('.tags .t')].map(e => txt(e)).filter(Boolean),
          info, group, img: img ? img.getAttribute('src') : null
        });
      });
      out.sections.push(s);
    });
    return out;
  }
  function inferPlaces(text) {
    const found = [];
    Geo.jp.features.forEach(f => { const n = f.properties.name, short = n === '北海道' ? n : n.replace(/(都|府|県)$/, ''); if (text.includes(short)) found.push(f.key); });
    if (!found.length) Geo.world.features.forEach(f => { const n = f.properties.n; if (n && n.length >= 2 && text.includes(n)) found.push(f.key); });
    return found;
  }
  async function guideImage(t, src, caption) {
    if (!src || !src.startsWith('data:')) return null;
    try {
      const r = await Photos.resizeBlob(Photos.dataUrlToBlob(src));
      const meta = { id: Store.uid('p'), tripId: t.id, kind: 'guide', takenAt: Date.now(), lat: null, lng: null, place: null, caption, w: r.w, h: r.h, createdAt: Date.now() };
      await Store.addPhotos([{ meta, full: r.full, thumb: r.thumb }]);
      return meta.id;
    } catch (e) { return null; }
  }
  async function importIntoTrip(t, html, onProgress) {
    const k = parseKozybook(html);
    ensure(t);
    const g = t.guide;
    if (!g.spots.length) g.sections = []; // replace the empty default sections
    if (!g.subtitle) g.subtitle = k.title;
    if (!(g.tags || []).length) g.tags = k.tags;
    const total = k.sections.reduce((n, s) => n + s.spots.length, 0); let n = 0;
    for (const ks of k.sections) {
      let sec = g.sections.find(x => x.pill === ks.pill && x.title === ks.title);
      if (!sec) { sec = { id: Store.uid('s'), pill: ks.pill || '📌', title: ks.title }; g.sections.push(sec); }
      for (const sp of ks.spots) {
        const photoId = await guideImage(t, sp.img, sp.name);
        g.spots.push({ id: Store.uid('sp'), sectionId: sec.id, name: sp.name, nameEn: sp.nameEn, area: sp.area, label: sp.label || sp.group, desc: sp.desc, point: sp.point, tags: sp.tags, info: sp.info, photoId, place: '', result: null, memo: '' });
        onProgress && onProgress(++n / total);
      }
    }
    if (!t.coverPhotoId && k.cover) t.coverPhotoId = await guideImage(t, k.cover, k.title);
    if (!t.coverPhotoId) { const f = g.spots.find(s => s.photoId); if (f) t.coverPhotoId = f.photoId; }
    if (!(t.places || []).length) t.places = inferPlaces(k.title + ' ' + k.tags.join(' '));
    await Store.saveTrip(t);
    return total;
  }
  async function createFromKozybook(file, onProgress) {
    const html = await file.text();
    const k = parseKozybook(html); // validate first
    const t = Store.newTrip({ status: 'plan', title: k.title.replace(/^KOZYBOOK\s*/, '').replace(/[〜~]/g, '').trim() || k.title });
    await importIntoTrip(t, html, onProgress);
    return t;
  }

  TB.Guide = { ensure, ensureDays, renderGuide, renderDays, parseKozybook, createFromKozybook, importIntoTrip, spotPhotoId };
})();
