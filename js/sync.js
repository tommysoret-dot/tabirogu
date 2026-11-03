/* TABIROGU — device-to-device sync (WebRTC data channel). The connection info is exchanged by QR codes
   (or a copied code), so no server stores or relays the travel data. */
(function () {
  const { Store, Geo } = TB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const PREFIX = 'TBRG1:';
  const CHUNK = 16 * 1024;

  /* ---------- libraries (loaded on demand) ---------- */
  const libs = {};
  function loadScript(url, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (libs[url]) return libs[url];
    libs[url] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = () => res(window[globalName]); s.onerror = () => { libs[url] = null; rej(new Error('部品を読み込めませんでした（ネット接続を確認してください）')); }; document.head.appendChild(s); });
    return libs[url];
  }
  const loadQR = () => loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'qrcode');
  const loadJsQR = () => loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'jsQR');

  /* ---------- signal encoding: SDP → deflate → base64 ---------- */
  const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = str => { const bin = atob(str); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  async function pipe(data, Stream) { const s = new Blob([data]).stream().pipeThrough(new Stream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
  function slimSdp(sdp) { // keep what a data channel needs; drop TCP candidates
    return sdp.split('\r\n').filter(l => l && !/^a=candidate:.* tcp /i.test(l) && !/^a=(extmap|msid|ssrc|rtcp-fb|fmtp|rtpmap)/.test(l)).join('\r\n') + '\r\n';
  }
  async function encode(desc) {
    const json = JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', s: slimSdp(desc.sdp) });
    if (window.CompressionStream) return PREFIX + 'z' + b64(await pipe(new TextEncoder().encode(json), CompressionStream));
    return PREFIX + 'j' + b64(new TextEncoder().encode(json));
  }
  async function decode(code) {
    code = (code || '').trim();
    if (!code.startsWith(PREFIX)) throw new Error('TABIROGUの同期コードではありません');
    const kind = code[PREFIX.length], body = unb64(code.slice(PREFIX.length + 1));
    const raw = kind === 'z' ? new TextDecoder().decode(await pipe(body, DecompressionStream)) : new TextDecoder().decode(body);
    const j = JSON.parse(raw);
    return { type: j.t === 'o' ? 'offer' : 'answer', sdp: j.s };
  }

  /* ---------- WebRTC ---------- */
  function waitIce(pc, ms = 3500) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  async function makeOffer() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const dc = pc.createDataChannel('tabirogu', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    return { pc, dc, code: await encode(pc.localDescription) };
  }
  async function makeAnswer(offerCode) {
    const offer = await decode(offerCode);
    if (offer.type !== 'offer') throw new Error('先に「同期をはじめる」側のコードを読んでください');
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const dcP = new Promise(res => pc.ondatachannel = e => res(e.channel));
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return { pc, dcP, code: await encode(pc.localDescription) };
  }
  const opened = dc => new Promise((res, rej) => {
    if (dc.readyState === 'open') return res(dc);
    const t = setTimeout(() => rej(new Error('つながりませんでした。ふたりとも同じWi-Fiにつないで、もう一度お試しください')), 25000);
    dc.onopen = () => { clearTimeout(t); res(dc); };
  });

  /* ---------- sync protocol ---------- */
  function manifest() {
    return {
      device: Store.settings.deviceName || '', version: 1,
      trips: Object.fromEntries(Store.trips.map(t => [t.id, t.updatedAt || 0])),
      photos: Object.fromEntries(Store.photos.map(p => [p.id, p.updatedAt || p.createdAt || 0])),
      deleted: Store.settings.deleted || {}, covers: Store.settings.covers || {}
    };
  }
  function channel(dc) { // message helpers with back-pressure for binary chunks
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 256 * 1024;
    const waitLow = () => dc.bufferedAmount < 1024 * 1024 ? Promise.resolve() : new Promise(r => { const f = () => { dc.removeEventListener('bufferedamountlow', f); r(); }; dc.addEventListener('bufferedamountlow', f); });
    return {
      json: async o => { await waitLow(); dc.send(JSON.stringify(o)); },
      bin: async buf => { for (let i = 0; i < buf.byteLength; i += CHUNK) { await waitLow(); dc.send(buf.slice(i, i + CHUNK)); } }
    };
  }
  async function run(dc, ui) {
    const ch = channel(dc);
    const stats = { sentTrips: 0, sentPhotos: 0, gotTrips: 0, gotPhotos: 0, deleted: 0 };
    const before = TB.UI.calc();
    let peer = null, peerDone = false, meDone = false, pending = null; // pending binary photo
    const writes = [];
    const finished = new Promise((resolve, reject) => {
      const check = () => { if (peerDone && meDone) resolve(); };
      dc.onclose = () => { if (!(peerDone && meDone)) reject(new Error('途中で接続が切れました。もう一度同期してください（続きから再開されます）')); };
      dc.onmessage = async (e) => {
        try {
          if (typeof e.data !== 'string') { // a photo chunk
            if (!pending) return;
            pending.parts.push(new Uint8Array(e.data)); pending.got += e.data.byteLength;
            if (pending.got >= pending.total) {
              const all = new Uint8Array(pending.total); let o = 0; pending.parts.forEach(p => { all.set(p, o); o += p.length; });
              const p = pending; pending = null;
              const w = Store.putPhotoRaw(p.meta, { id: p.meta.id, type: p.type, full: all.slice(0, p.fullLen).buffer, thumb: all.slice(p.fullLen).buffer }); writes.push(w); await w;
              stats.gotPhotos++; ui.progress(`写真を受け取り中… ${stats.gotPhotos}枚`);
            }
            return;
          }
          const m = JSON.parse(e.data);
          if (m.t === 'hello') { peer = m.manifest; ui.peer(peer.device); await sendWhatPeerLacks(); meDone = true; await ch.json({ t: 'done' }); check(); }
          else if (m.t === 'trip') { const cur = Store.trips.find(x => x.id === m.trip.id); if (!cur || (m.trip.updatedAt || 0) > (cur.updatedAt || 0)) { const w = Store.putTripRaw(m.trip); writes.push(w); await w; stats.gotTrips++; } }
          else if (m.t === 'pmeta') { const cur = Store.photos.find(x => x.id === m.meta.id); if (cur && (m.meta.updatedAt || 0) > (cur.updatedAt || 0)) await Store.putPhotoRaw(m.meta, null); }
          else if (m.t === 'photo') pending = { meta: m.meta, type: m.type, fullLen: m.fullLen, total: m.total, got: 0, parts: [] };
          else if (m.t === 'covers') { Store.settings.covers = Object.assign({}, m.covers, Store.settings.covers); }
          else if (m.t === 'deleted') { const w = applyDeletions(m.deleted).then(n => { stats.deleted += n; }); writes.push(w); await w; }
          else if (m.t === 'done') { await Promise.all(writes); peerDone = true; check(); }
        } catch (err) { reject(err); }
      };
    });
    async function sendWhatPeerLacks() {
      const del = Store.settings.deleted || {};
      await ch.json({ t: 'deleted', deleted: del });
      await ch.json({ t: 'covers', covers: Store.settings.covers || {} });
      for (const t of Store.trips) {
        if ((peer.trips[t.id] || -1) < (t.updatedAt || 0) && !(peer.deleted['t:' + t.id] >= (t.updatedAt || 0))) { await ch.json({ t: 'trip', trip: t }); stats.sentTrips++; }
      }
      const todo = Store.photos.filter(p => !(p.id in peer.photos) && !peer.deleted['p:' + p.id]);
      for (const p of Store.photos) if ((p.id in peer.photos) && (p.updatedAt || 0) > peer.photos[p.id]) await ch.json({ t: 'pmeta', meta: p });
      for (const p of todo) {
        const r = await Store.getBlobRaw(p.id); if (!r || !r.full) continue;
        const full = new Uint8Array(r.full), thumb = new Uint8Array(r.thumb || new ArrayBuffer(0));
        const both = new Uint8Array(full.length + thumb.length); both.set(full, 0); both.set(thumb, full.length);
        await ch.json({ t: 'photo', meta: p, type: r.type, fullLen: full.length, total: both.length });
        await ch.bin(both.buffer);
        stats.sentPhotos++; ui.progress(`写真を送信中… ${stats.sentPhotos}/${todo.length}枚`);
      }
    }
    async function applyDeletions(del) {
      let n = 0; Store.settings.deleted = Store.settings.deleted || {};
      for (const [k, at] of Object.entries(del || {})) {
        if (!Store.settings.deleted[k]) Store.settings.deleted[k] = at;
        const id = k.slice(2);
        if (k.startsWith('t:')) { const t = Store.trips.find(x => x.id === id); if (t && (t.updatedAt || 0) <= at) { await Store.deleteTrip(id); n++; } }
        else { const p = Store.photos.find(x => x.id === id); if (p) { await Store.deletePhoto(id); n++; } }
      }
      return n;
    }
    await ch.json({ t: 'hello', manifest: manifest() });
    await finished;
    await Promise.all(writes);
    await Store.saveSettings();
    TB.UI.recalc(); TB.UI.refresh();
    return { stats, diff: Geo.diff(before, TB.UI.calc()) };
  }

  /* ---------- QR display & scanning ---------- */
  async function qrSvg(text) {
    const qrcode = await loadQR();
    const q = qrcode(0, 'L'); q.addData(text, 'Byte'); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }
  function scanner(box, onCode) {
    let stream = null, stopped = false;
    const video = document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true; video.className = 'scan-video';
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    box.innerHTML = ''; box.appendChild(video);
    const stop = () => { stopped = true; if (stream) stream.getTracks().forEach(t => t.stop()); };
    (async () => {
      try {
        const jsQR = await loadJsQR();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream; await video.play();
        const tick = () => {
          if (stopped) return;
          if (video.videoWidth) {
            const w = 640, h = Math.round(video.videoHeight * 640 / video.videoWidth);
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (r && r.data && r.data.startsWith(PREFIX)) { stop(); onCode(r.data); return; }
          }
          setTimeout(tick, 180);
        };
        tick();
      } catch (e) { box.innerHTML = `<p class="muted" style="font-size:13px">カメラを使えませんでした（${esc(e.message)}）。下の「コードを貼り付け」を使ってください。</p>`; }
    })();
    return stop;
  }

  /* ---------- UI ---------- */
  function open(role) {
    let pc = null, stopScan = null, wake = null;
    TB.UI.sheet(`<div class="stack sync-sheet"><h3>${role === 'host' ? '同期をはじめる' : '相手のQRを読む'}</h3><div id="sy-body" class="stack"></div>
      <p class="muted" style="margin:0;font-size:11px">データはふたりの端末の間で暗号化して直接やり取りします。どこにも保存されません。</p></div>`, async (el, close) => {
      const body = el.querySelector('#sy-body');
      const overlay = el.closest('.overlay');
      const cleanup = () => { if (stopScan) stopScan(); try { wake && wake.release(); } catch (e) { } };
      overlay.addEventListener('click', e => { if (e.target === overlay) { cleanup(); if (pc && pc.connectionState !== 'connected') pc.close(); } });
      try { wake = await navigator.wakeLock.request('screen'); } catch (e) { }
      const showCode = async (code, title, next) => {
        let svg = ''; try { svg = await qrSvg(code); } catch (e) { }
        body.innerHTML = `<p style="margin:0">${title}</p>
          ${svg ? `<div class="qr-box">${svg}</div>` : ''}
          <details><summary class="muted" style="font-size:13px">QRが使えないとき（コードをコピーしてLINEなどで送る）</summary>
            <div class="row" style="margin-top:8px"><button class="btn small" data-copy>コードをコピー</button></div>
            <textarea readonly class="code-box">${esc(code)}</textarea></details>
          ${next || ''}`;
        body.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(code); TB.UI.toast('コピーしました'); } catch (e) { const ta = body.querySelector('.code-box'); ta.select(); } };
      };
      const readCode = (title, onCode) => {
        body.innerHTML = `<p style="margin:0">${title}</p><div class="scan-box"></div>
          <details><summary class="muted" style="font-size:13px">コードを貼り付けて進む</summary><textarea class="code-box" id="sy-paste" placeholder="TBRG1:…"></textarea><button class="btn small" data-paste style="margin-top:6px">このコードで進む</button></details>`;
        stopScan = scanner(body.querySelector('.scan-box'), onCode);
        body.querySelector('[data-paste]').onclick = () => { const v = body.querySelector('#sy-paste').value; if (v.trim()) { if (stopScan) stopScan(); onCode(v.trim()); } };
      };
      const go = async (dc) => {
        body.innerHTML = `<p style="margin:0" id="sy-who">つながりました。同期しています…</p><div class="progress"><i style="width:100%;opacity:.4"></i></div><p class="muted mono" id="sy-prog" style="margin:0;font-size:12px"></p>`;
        try {
          const r = await run(dc, { progress: t => { const e = body.querySelector('#sy-prog'); if (e) e.textContent = t; }, peer: name => { const e = body.querySelector('#sy-who'); if (e) e.textContent = `${name || '相手の端末'}とつながりました。同期しています…`; } });
          const s = r.stats;
          body.innerHTML = `<div class="celebrate"><div class="stampmark">同期<br>完了</div>
            <ul><li>受け取り：旅 ${s.gotTrips}件・写真 ${s.gotPhotos}枚</li><li>送信：旅 ${s.sentTrips}件・写真 ${s.sentPhotos}枚</li>${s.deleted ? `<li>相手の削除を反映：${s.deleted}件</li>` : ''}</ul>
            <button class="btn primary" data-ok>閉じる</button></div>`;
          body.querySelector('[data-ok]').onclick = () => { close(); TB.UI.celebrate(r.diff); };
          Store.settings.lastSync = Date.now(); await Store.saveSettings();
          setTimeout(() => { try { pc.close(); } catch (e) { } }, 1500);
        } catch (e) { body.innerHTML = `<p style="color:var(--stamp)">${esc(e.message)}</p><button class="btn" data-ok>閉じる</button>`; body.querySelector('[data-ok]').onclick = close; }
        cleanup();
      };
      try {
        if (role === 'host') {
          body.innerHTML = '<p class="muted">準備しています…<br>カメラの許可を求められたら「許可」を押してください（あとで相手のQRを読むのに使い、つながりやすくもなります）。</p>';
          // On iPhone, Safari reveals the real local address only while the camera is allowed → better same-Wi-Fi connections
          let warm = null; try { warm = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch (e) { }
          const o = await makeOffer(); pc = o.pc;
          if (warm) warm.getTracks().forEach(t => t.stop());
          await showCode(o.code, '① 相手のスマホで「相手のQRを読む」を押して、このQRを読んでもらってください。', '<button class="btn primary block" data-next>② 相手に出たQRを読む</button>');
          body.querySelector('[data-next]').onclick = () => readCode('② 相手の画面に出たQRをカメラで読んでください。', async code => {
            try {
              const ans = await decode(code); if (ans.type !== 'answer') throw new Error('相手側（読んだ側）に出たQRを読んでください');
              body.innerHTML = '<p class="muted">接続しています…</p>';
              await pc.setRemoteDescription(ans); go(await opened(o.dc));
            } catch (e) { TB.UI.toast(e.message); }
          });
        } else {
          readCode('相手のスマホに出たQRをカメラで読んでください。', async code => {
            try {
              body.innerHTML = '<p class="muted">準備しています…</p>';
              const a = await makeAnswer(code); pc = a.pc;
              await showCode(a.code, 'このQRを、相手のスマホで読んでもらってください。つながると自動で同期が始まります。');
              const dc = await a.dcP; go(await opened(dc));
            } catch (e) { body.innerHTML = `<p style="color:var(--stamp)">${esc(e.message)}</p>`; }
          });
        }
      } catch (e) { body.innerHTML = `<p style="color:var(--stamp)">${esc(e.message)}</p>`; }
    });
  }

  TB.Sync = { open, encode, decode, makeOffer, makeAnswer, run, opened };
})();
