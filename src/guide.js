// Panel Panduan: pilih skenario, jalankan otomatis atau coba sendiri, checklist tercentang dari kejadian nyata.
import morphdom from 'morphdom';
import { on, narrate, sleep, clock, esc } from './core.js';
import * as srv from './server.js';
import { SCENARIOS, GROUPS } from './scenarios.js';

export function mountGuide(el, { app, ui }) {
  const results = {}; // id -> 'pass' | 'fail'
  let selected = SCENARIOS[0].id;
  let run = null; // { sc, mode, steps[], forbids[], idx, facts[], status, error, token }
  let runAll = null;
  let introOpen = true;

  const sc = () => SCENARIOS.find((s) => s.id === selected);

  // ---------------------------------------------------------- pencocokan kejadian
  on((m) => {
    if (m.kind !== 'fact' || !run || run.status === 'done' || run.status === 'setup') return;
    const f = m.f;
    run.counts[f.type] = (run.counts[f.type] || 0) + 1; f._n = run.counts[f.type];
    run.facts.push(f);
    for (const fb of run.forbids) if (!fb.violated && fb.m(f)) { fb.violated = true; }
    const step = run.steps[run.idx];
    if (step && step.m(f)) { step.done = true; run.idx++; }
    if (run.mode === 'manual' && run.idx >= run.steps.length) finish();
    for (const w of [...run.waiters]) if (w.m(f)) { run.waiters.delete(w); w.resolve(f); }
    render();
  });

  function setup(opts = {}) {
    const o = { account: 'sari', sound: true, consent: true, platform: 'android', load: 'normal', consentSave: 'ok', location: 'while', ...opts };
    return (async () => {
      const d = app.dev;
      if (!d.alive) await app.revive();
      if (!d.online) app.setOnline(true);
      if (d.inCall) app.setCall(false);
      if (!d.foreground) app.setForeground(true);
      if (d.platform !== o.platform) app.setPlatform(o.platform);
      app.setLoadMode(o.load); app.setConsentSaveMode(o.consentSave);
      d.overlay = null;
      if (d.location.status === 'belum' || d.location.status === 'expired') d.location.status = 'while'; // hindari popup saat persiapan
      if (!d.account || d.account.userId !== o.account) await app.login(o.account);
      d.overlay = null;
      if (o.location === 'belum') d.location = { status: 'belum', lastAskAt: 0 };
      if (o.consent === 'none') { srv.revokeConsentForDemo(o.account); d.consentValid = false; }
      else if (o.consent && !srv.consentStatus(o.account).valid) { srv.saveConsent(o.account, d.id, srv.getTnc().version); d.consentValid = true; }
      else if (o.consent) d.consentValid = true;
      d.soundOn = !!o.sound && d.consentValid; d.soundPrefs[o.account] = d.soundOn;
      // campaign contoh yang dipakai skenario dipastikan aktif
      for (const name of ['Promo Kopi Senja', 'Isi Pulsa Hemat', 'Asuransi Mikro']) { const c = srv.campaignByName(name); if (c?.isPaused && !c.pendingRequestId) srv.resume(c.id, 'andi'); }
      app.resetForScenario();
      d.page = 'dasbor'; d.overlay = null;
      if (o.location === 'belum') d.page = 'qr';
      app.refresh();
      await sleep(400);
    })();
  }

  async function start(id, mode) {
    stop(true);
    selected = id;
    const s = sc();
    const token = {};
    run = { sc: s, mode, token, steps: s.expect().map(([label, m]) => ({ label, m, done: false })), forbids: (s.forbid?.() || []).map(([label, m]) => ({ label, m, violated: false })),
      idx: 0, counts: {}, facts: [], waiters: new Set(), status: 'setup', error: null, cleanup: [] };
    render();
    narrate('demo', `▶ Skenario: ${s.title}${mode === 'manual' ? ' (coba sendiri)' : ''}. Kondisi HP disiapkan dan interval perangkat direset.`);
    await setup(s.setup);
    if (run?.token !== token) return;
    run.status = 'running';
    render();
    if (mode === 'manual') return;
    const ctx = makeCtx(token);
    try {
      await s.run(ctx);
      await sleep(400);
    } catch (e) { if (run?.token === token && e.message !== 'stopped') run.error = e.message; }
    if (run?.token === token) finish();
  }
  function makeCtx(token) {
    const guard = () => { if (run?.token !== token) throw new Error('stopped'); };
    return {
      app, srv, now: () => clock.now(), cleanup: run.cleanup,
      pay(amount = 50000, opts = {}) { guard(); return srv.simulateTransaction(app.dev.account.mid, amount, opts); },
      async sleep(ms) { await sleep(ms); guard(); },
      wait(m, timeout = 20000) {
        guard();
        const seen = run.facts.find((f) => !run.consumed?.has(f.seq) && m(f));
        if (seen) { (run.consumed ||= new Set()).add(seen.seq); return Promise.resolve(seen); }
        return new Promise((resolve, reject) => {
          const w = { m, resolve: (f) => { clearTimeout(t); (run.consumed ||= new Set()).add(f.seq); resolve(f); } };
          const t = setTimeout(() => { run?.waiters.delete(w); reject(new Error('Kejadian yang ditunggu tidak muncul dalam batas waktu.')); }, timeout);
          run.waiters.add(w);
        });
      },
      advance(ms) { guard(); clock.advance(ms); },
      note(t) { narrate('demo', t); },
      admin: {
        pause: (id, reason) => srv.pause(id, 'andi', reason),
        resume: (id) => { try { srv.resume(id, 'andi'); } catch { /* sudah aktif */ } },
        add: (input) => srv.addCampaign(input, 'andi'),
      },
      showAdmin: (view, id) => ui.showAdmin(view, id),
      refreshParams: () => ui.refreshParams(),
      ui: { scrollAndCheck: ui.scrollAndCheck },
    };
  }
  function finish() {
    if (!run || run.status === 'done') return;
    run.status = 'done';
    for (const fn of run.cleanup) { try { fn(); } catch { /* */ } }
    const pass = !run.error && run.steps.every((s) => s.done) && run.forbids.every((f) => !f.violated);
    results[run.sc.id] = pass ? 'pass' : 'fail';
    narrate('demo', pass ? `✓ Skenario "${run.sc.title}" sesuai PRD.` : `⨯ Skenario "${run.sc.title}" belum sesuai: ${run.error || 'ada langkah yang tidak terjadi atau kejadian terlarang muncul'}.`, { tone: pass ? 'ok' : 'warn' });
    render();
    runAll?.next();
  }
  function stop(silent) {
    if (!run || run.status === 'done') return;
    run.token = {}; run.status = 'done';
    for (const fn of run.cleanup) { try { fn(); } catch { /* */ } }
    if (!silent) narrate('demo', `■ Skenario "${run.sc.title}" dihentikan.`);
    render();
  }
  function startAll() {
    const queue = SCENARIOS.map((s) => s.id);
    runAll = { total: queue.length, next: () => { const id = queue.shift(); if (!id || !runAll) { runAll = null; render(); return; } setTimeout(() => start(id, 'auto'), 900); } };
    runAll.next();
  }

  // ---------------------------------------------------------- tampilan
  function render() {
    const s = sc();
    const active = run && run.sc.id === s.id ? run : null;
    const status = active ? active.status : null;
    const icon = (st) => st === 'done' ? '✓' : st === 'current' ? '›' : '';
    const stepsHtml = (active ? active.steps : s.expect().map(([label]) => ({ label, done: false }))).map((st, i) => {
      const cur = active && status === 'running' && i === active.idx;
      const failed = active && status === 'done' && !st.done;
      return `<li class="${st.done ? 'done' : cur ? 'cur' : failed ? 'miss' : ''}"><span class="mk">${st.done ? icon('done') : failed ? '!' : cur ? icon('current') : ''}</span>${esc(st.label)}</li>`;
    }).join('');
    const forbids = (active ? active.forbids : (s.forbid?.() || []).map(([label]) => ({ label })));
    const forbidHtml = forbids.length ? `<h5>Tidak boleh terjadi</h5><ul class="forbid">${forbids.map((fb) => `<li class="${fb.violated ? 'bad' : active?.status === 'done' ? 'good' : ''}"><span class="mk">${fb.violated ? '⨯' : active?.status === 'done' ? '✓' : ''}</span>${esc(fb.label)}</li>`).join('')}</ul>` : '';
    const res = results[s.id];
    const verdict = active?.status === 'done' ? (res === 'pass' ? '<div class="verdict pass">Sesuai PRD</div>' : `<div class="verdict fail">Belum sesuai${active.error ? `: ${esc(active.error)}` : ''}</div>`) : '';
    const idx = SCENARIOS.findIndex((x) => x.id === s.id);
    const passed = Object.values(results).filter((r) => r === 'pass').length;
    const html = `<div>
      <div class="g-head"><h2>Panduan mencoba</h2><button class="linkbtn" data-g="intro">${introOpen ? 'Sembunyikan cara pakai' : 'Cara pakai'}</button></div>
      ${introOpen ? `<ol class="howto"><li>Pilih skenario di daftar bawah.</li><li>Klik <b>Jalankan otomatis</b> untuk melihat demonya, atau <b>Coba sendiri</b> lalu ikuti langkahnya dengan tombol di bawah HP.</li><li>Dengarkan HP dan baca panel <b>Alur</b>. Checklist tercentang sendiri saat kejadiannya benar-benar terjadi.</li></ol>` : ''}
      <article class="scard ${status === 'running' || status === 'setup' ? 'running' : ''}">
        <div class="sc-nav"><button class="iconbtn" data-g="prev" ${idx === 0 ? 'disabled' : ''} aria-label="Skenario sebelumnya">‹</button><span>${GROUPS[s.group]} · ${idx + 1}/${SCENARIOS.length}</span><button class="iconbtn" data-g="next" ${idx === SCENARIOS.length - 1 ? 'disabled' : ''} aria-label="Skenario berikutnya">›</button></div>
        <h3>${esc(s.title)}</h3>
        <blockquote><span>Aturan PRD</span>${esc(s.rule)}</blockquote>
        <div class="sc-btns">${status === 'running' || status === 'setup'
          ? `<button class="btn" data-g="stop">Hentikan</button><span class="running-lbl">${active.mode === 'manual' ? 'Menunggu Anda mencoba…' : 'Sedang berjalan…'}</span>`
          : `<button class="btn primary" data-g="auto">▶ Jalankan otomatis</button><button class="btn" data-g="manual">Coba sendiri</button>`}</div>
        ${verdict}
        <h5>Yang harus terjadi</h5><ul class="expect">${stepsHtml}</ul>${forbidHtml}
        <details class="manual" ${active?.mode === 'manual' ? 'open' : ''}><summary>Langkah jika mencoba sendiri</summary><ol>${s.steps.map((x) => `<li>${x}</li>`).join('')}</ol></details>
      </article>
      <div class="g-list-h"><h4>Semua skenario</h4><span class="sub">${passed}/${SCENARIOS.length} sesuai</span></div>
      <div class="g-list">${GROUPS.map((g, gi) => `<div class="g-group"><h6>${g}</h6>${SCENARIOS.filter((x) => x.group === gi).map((x) => `<button class="g-item ${x.id === s.id ? 'on' : ''}" data-sel="${x.id}"><span class="dot ${results[x.id] || (run?.sc.id === x.id && run.status !== 'done' ? 'run' : '')}"></span>${esc(x.title)}</button>`).join('')}</div>`).join('')}</div>
      <button class="btn block" data-g="all" ${runAll ? 'disabled' : ''}>${runAll ? 'Menjalankan semua skenario…' : 'Jalankan semua skenario berurutan (±12 menit)'}</button>
    </div>`;
    morphdom(el, html, { childrenOnly: true });
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.sel) { if (!(run && run.status !== 'done')) { selected = b.dataset.sel; render(); } else { selected = b.dataset.sel; render(); } return; }
    const g = b.dataset.g;
    const i = SCENARIOS.findIndex((x) => x.id === selected);
    if (g === 'intro') { introOpen = !introOpen; render(); }
    else if (g === 'prev') { selected = SCENARIOS[i - 1].id; render(); }
    else if (g === 'next') { selected = SCENARIOS[i + 1].id; render(); }
    else if (g === 'auto') start(selected, 'auto');
    else if (g === 'manual') start(selected, 'manual');
    else if (g === 'stop') { runAll = null; stop(); }
    else if (g === 'all') startAll();
  });
  render();
  return { render, start, results, get run() { return run; } };
}
