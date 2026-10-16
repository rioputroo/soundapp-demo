// Dashboard Admin: Manajemen Iklan, Approval (tipe Iklan), Log, sesuai PRD.
import { on, esc, fmtDateTime, fmtShort, fmtDur, toWibInput, fromWibInput, clock } from './core.js';
import * as srv from './server.js';
import { makeSampleAd } from './audio.js';

const pill = (st) => `<span class="pill st-${st}">${srv.STATUS_LABEL[st] || st}</span>`;
const reqPill = (st) => `<span class="pill rq-${st}">${{ MENUNGGU: 'Menunggu', DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak' }[st]}</span>`;
const resPill = (st) => `<span class="pill rs-${st}">${srv.RESULT_LABEL[st]}</span>`;
const FIELD_LABEL = { name: 'Nama Campaign', startAt: 'Mulai tayang', endAt: 'Akhir tayang', advertiserMid: 'MID pengiklan', excludeSelf: 'Tidak tayang di aplikasi sendiri', mccExclusions: 'Filter MCC (dikecualikan)' };
const fmtVal = (k, v) => k === 'startAt' || k === 'endAt' ? fmtDateTime(v) : k === 'advertiserMid' ? (v ? `${v} – ${srv.merchantOf(v)?.name}` : '—') : k === 'excludeSelf' ? (v ? 'Ya' : 'Tidak') : k === 'mccExclusions' ? (v?.length ? v.map((c) => `${c} – ${srv.MCC.find((m) => m.code === c)?.name}`).join(', ') : 'Tidak ada') : (v ?? '—');

export function mountAdmin(root) {
  const st = { admin: 'andi', view: 'list', id: null, pauseOpen: false, form: null, approvalFilter: { kind: 'all', status: 'all' }, logBox: 'pemutaran', logFilter: { campaign: 'all', result: 'all', mid: '' }, msg: null };
  const perms = () => srv.ADMINS.find((a) => a.id === st.admin).perms;
  const can = (p) => perms().includes(p);

  function nav() {
    const tabs = [['list', 'Manajemen Iklan', 'IKLAN'], ['approval', 'Approval', 'APPROVAL'], ['log', 'Log', 'LOG']];
    const section = st.view.startsWith('approval') ? 'approval' : st.view === 'log' ? 'log' : 'list';
    return `<div class="adm-top"><label class="adm-who">Masuk dashboard sebagai <select id="adm-user">${srv.ADMINS.map((a) => `<option value="${a.id}" ${a.id === st.admin ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <span class="perm-chips">${['IKLAN', 'APPROVAL', 'LOG'].map((p) => `<span class="perm ${can(p) ? 'yes' : 'no'}">${{ IKLAN: 'Manajemen Iklan', APPROVAL: 'Approval Iklan', LOG: 'Log' }[p]}</span>`).join('')}</span></div>
      <nav class="adm-nav">${tabs.map(([k, l, p]) => `<button data-nav="${k}" class="${section === k ? 'on' : ''}" ${can(p) ? '' : 'disabled title="Tidak punya hak akses"'}>${l}</button>`).join('')}</nav>
      ${st.msg ? `<div class="adm-msg ${st.msg.tone}">${esc(st.msg.text)}</div>` : ''}`;
  }
  const denied = (p) => `<div class="empty-state"><b>Akun ini tidak punya hak akses ${p}.</b><p>Hak akses diatur saat menambah/mengubah akun admin. Pilih akun lain di atas.</p></div>`;

  // ---------------------------------------------------------- daftar
  function listView() {
    if (!can('IKLAN')) return denied('Manajemen Iklan');
    const rows = srv.listCampaigns();
    return `<div class="adm-h"><h3>Manajemen Iklan</h3><button class="btn primary" data-go="add">+ Tambah Iklan</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>No.</th><th>Nama Campaign</th><th>Nama Pengiklan</th><th>No. Telepon</th><th>Awal Tayang</th><th>Akhir Tayang</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((c, i) => `<tr class="clickable" data-open="${c.id}"><td>${i + 1}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.advertiserName)}</td><td class="num">${esc(c.advertiserPhone)}</td><td class="num">${fmtDateTime(c.startAt)}</td><td class="num">${fmtDateTime(c.endAt)}</td><td>${pill(c.status)}</td><td><button class="btn sm" data-open="${c.id}">Detail</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Belum ada iklan.</td></tr>'}
      </tbody></table></div>
      <p class="note">Urutan giliran pemutaran mengikuti waktu submit Tambah Iklan (paling awal lebih dulu).</p>`;
  }

  // ---------------------------------------------------------- detail
  function detailView() {
    const c = srv.getCampaign(st.id);
    const a = c.actions;
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    const sum = c.summary;
    let actions = '';
    if (c.status === 'MENUNGGU_PERSETUJUAN') actions = '<p class="inline-note">Iklan sedang menunggu persetujuan.</p>';
    else {
      actions = [a.includes('EDIT') && '<button class="btn" data-go="edit">Edit</button>', a.includes('PAUSE') && '<button class="btn" data-act="pause-open">Pause</button>', a.includes('RESUME') && '<button class="btn primary" data-act="resume">Resume</button>'].filter(Boolean).join('');
      if (c.status === 'SEDANG_TAYANG') actions += '<p class="inline-note">Pause campaign terlebih dahulu untuk mengedit.</p>';
    }
    const pauseForm = st.pauseOpen ? `<form class="pause-form" id="pause-form"><label for="pause-reason">Alasan pause (wajib, maks. 255 karakter)</label><textarea id="pause-reason" maxlength="255" rows="2" placeholder="Contoh: Pengiklan meminta jeda sementara"></textarea>
      <div class="row-btns"><span class="count" id="pause-count">0/255</span><button type="button" class="btn" data-act="pause-cancel">Batal</button><button class="btn primary" type="submit">Pause campaign</button></div><p class="ferr" id="pause-err"></p></form>` : '';
    return `<div class="adm-h"><button class="btn ghost" data-go="list">← Daftar</button><h3>${esc(c.name)}</h3>${pill(c.status)}</div>
      ${c.pendingRequest ? `<div class="banner warn">Ada request "${c.pendingRequest.kind === 'TAMBAH' ? 'Tambah Iklan' : 'Ubah Iklan'}" yang berjalan oleh ${esc(c.pendingRequest.makerId)}. Data terkunci sampai diproses.</div>` : ''}
      <div class="detail-grid">
        <div class="dcard">${kv('Nama Pengiklan', esc(c.advertiserName))}${kv('No. Telepon', esc(c.advertiserPhone))}${kv('MID Pengiklan', c.advertiserMid ? `${c.advertiserMid} – ${esc(c.advertiserMerchant)}` : 'Bukan merchant')}${kv('Tidak tayang di aplikasi sendiri', c.excludeSelf ? 'Ya' : 'Tidak')}${kv('Filter MCC (tidak menerima)', fmtVal('mccExclusions', c.mccExclusions))}${kv('Jadwal', `${fmtDateTime(c.startAt)} — ${fmtDateTime(c.endAt)}`)}${c.pauseReason && c.isPaused ? kv('Alasan pause', esc(c.pauseReason)) : ''}</div>
        <div class="dcard"><span class="lbl">Materi audio</span><audio controls preload="none" src="${c.media.url}"></audio><span class="sub">${c.media.format} · ${fmtDur(c.media.durationMs)} · ${(c.media.size / 1024).toFixed(0)} KB. Preview tidak dihitung sebagai tayang.</span>
          <span class="lbl">Hasil pemutaran</span><div class="sum"><div><b>${sum.COMPLETED}</b><span>Selesai</span></div><div><b>${sum.FAILED_TO_START}</b><span>Gagal dimulai</span></div><div><b>${sum.INTERRUPTED}</b><span>Terputus</span></div></div></div>
      </div>
      ${can('IKLAN') ? `<div class="actions">${actions}</div>${pauseForm}` : ''}`;
  }

  // ---------------------------------------------------------- form tambah / edit
  function formView(mode) {
    const c = mode === 'edit' ? srv.getCampaign(st.id) : null;
    const f = st.form;
    const err = (k) => f.errors?.[k] ? `<p class="ferr">${esc(f.errors[k])}</p>` : '';
    const midSel = f.advertiserMid ? srv.merchantOf(f.advertiserMid) : null;
    return `<div class="adm-h"><button class="btn ghost" data-go="${mode === 'edit' ? 'detail' : 'list'}">← Batal</button><h3>${mode === 'edit' ? `Edit Iklan · ${esc(c.name)}` : 'Tambah Iklan'}</h3></div>
      ${mode === 'edit' ? '<div class="banner">Perubahan berlaku pada pemutaran berikutnya setelah request disetujui.</div>' : ''}
      <form class="aform" id="ad-form" novalidate>
        ${mode === 'add' ? `<label>Nama Pengiklan*<input id="f-advertiserName" value="${esc(f.advertiserName)}" placeholder="Nama usaha atau perusahaan"/>${err('advertiserName')}</label>
        <label>No. Telepon Pengiklan*<input id="f-advertiserPhone" inputmode="tel" value="${esc(f.advertiserPhone)}" placeholder="081234567890"/>${err('advertiserPhone')}</label>` : `<div class="ro"><span>Pengiklan</span><b>${esc(c.advertiserName)} · ${esc(c.advertiserPhone)}</b></div><div class="ro"><span>Materi audio</span><b>${c.media.format} · ${fmtDur(c.media.durationMs)}</b></div>`}
        <label class="span2">Nama Campaign*<input id="f-name" value="${esc(f.name)}"/>${err('name')}</label>
        ${mode === 'add' ? `<div class="span2 upload"><span class="lbl">Materi audio* <em>M4A / MP3 / WAV, maks. 5 MB</em></span>
          <div class="row-btns left"><label class="btn file">Unggah file (lokal)<input type="file" id="f-file" accept=".m4a,.mp3,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a"/></label><button type="button" class="btn ghost" data-act="sample">Pakai audio contoh</button></div>
          ${f.media ? `<div class="preview"><audio controls src="${f.media.url}"></audio><span>${esc(f.media.fileName)} · ${f.media.format} · ${fmtDur(f.media.durationMs)} · ${(f.media.size / 1024).toFixed(0)} KB</span></div><p class="sub">File baru benar-benar diunggah ke server saat menekan Simpan. Durasi tidak dibatasi sistem; dicek saat review manual.</p>` : ''}
          ${f.fileError ? `<p class="ferr">${esc(f.fileError)}</p>` : ''}${err('media')}</div>` : ''}
        <label>Mulai tayang (WIB)*<input type="datetime-local" id="f-start" value="${f.start}"/>${err('startAt')}</label>
        <label>Akhir tayang (WIB)*<input type="datetime-local" id="f-end" value="${f.end}"/>${err('endAt')}</label>
        <div class="span2 search"><span class="lbl">MID pengiklan <em>opsional, cari berdasarkan nomor MID</em></span>
          ${midSel ? `<div class="chosen"><span>${midSel.mid} – ${esc(midSel.name)}</span><button type="button" class="x" data-act="mid-clear" aria-label="Hapus MID">×</button></div>` : `<input id="f-mid" placeholder="Ketik nomor MID, mis. 2505" value="${esc(f.midQuery || '')}" autocomplete="off"/>
            ${f.midQuery ? `<div class="sugg">${(() => { const r = srv.MERCHANTS.filter((m) => m.mid.includes(f.midQuery.replace(/\D/g, ''))); return r.length ? r.map((m) => `<button type="button" data-mid="${m.mid}">${m.mid} – ${esc(m.name)}</button>`).join('') : '<p class="sub">MID tidak ditemukan di master merchant.</p>'; })()}</div>` : ''}`}
          ${err('advertiserMid')}
          <label class="cbx ${f.advertiserMid ? '' : 'off'}"><input type="checkbox" id="f-self" ${f.excludeSelf ? 'checked' : ''} ${f.advertiserMid ? '' : 'disabled'}/> Tidak mau iklan tampil di aplikasi sendiri</label>
          ${f.midChanged && f.advertiserMid ? '<p class="sub">MID berubah: konfirmasi ulang pilihan pengecualian sendiri.</p>' : ''}</div>
        <div class="span2 search"><span class="lbl">Filter MCC <em>kategori merchant yang tidak menerima iklan ini; kosong = tidak ada pengecualian</em></span>
          <div class="chips">${f.mcc.map((code) => `<span class="chip">${code} – ${esc(srv.MCC.find((m) => m.code === code).name)}<button type="button" class="x" data-mcc-del="${code}" aria-label="Hapus">×</button></span>`).join('')}</div>
          <input id="f-mccq" placeholder="Cari kode atau nama MCC" value="${esc(f.mccQuery || '')}" autocomplete="off"/>
          ${f.mccQuery ? `<div class="sugg">${(() => { const q = f.mccQuery.toLowerCase(); const r = srv.MCC.filter((m) => !f.mcc.includes(m.code) && (m.code.includes(q) || m.name.toLowerCase().includes(q))); return r.length ? r.map((m) => `<button type="button" data-mcc="${m.code}">${m.code} – ${esc(m.name)}</button>`).join('') : '<p class="sub">Kategori tidak ditemukan.</p>'; })()}</div>` : ''}</div>
        <div class="span2 row-btns"><button type="button" class="btn" data-go="${mode === 'edit' ? 'detail' : 'list'}">Batal</button><button class="btn primary" type="submit">${mode === 'edit' ? 'Ajukan perubahan' : 'Simpan'}</button></div>
      </form>`;
  }
  function newForm(mode) {
    if (mode === 'edit') {
      const c = srv.getCampaign(st.id);
      return { name: c.name, start: toWibInput(c.startAt), end: toWibInput(c.endAt), advertiserMid: c.advertiserMid, excludeSelf: c.excludeSelf, mcc: [...c.mccExclusions], baseMid: c.advertiserMid };
    }
    const now = clock.now();
    return { advertiserName: '', advertiserPhone: '', name: '', media: null, start: toWibInput(now + 5 * 60e3), end: toWibInput(now + 14 * 864e5), advertiserMid: null, excludeSelf: false, mcc: [] };
  }
  function readForm() {
    const f = st.form; const q = (id) => root.querySelector(id);
    for (const [k, id] of [['advertiserName', '#f-advertiserName'], ['advertiserPhone', '#f-advertiserPhone'], ['name', '#f-name'], ['start', '#f-start'], ['end', '#f-end'], ['midQuery', '#f-mid'], ['mccQuery', '#f-mccq']]) if (q(id)) f[k] = q(id).value;
    if (q('#f-self')) f.excludeSelf = q('#f-self').checked;
  }

  // ---------------------------------------------------------- approval
  function approvalView() {
    if (!can('APPROVAL')) return denied('Approval Iklan');
    const fl = st.approvalFilter;
    const rows = srv.listRequests().filter((r) => (fl.kind === 'all' || r.kind === fl.kind) && (fl.status === 'all' || r.status === fl.status));
    return `<div class="adm-h"><h3>Approval</h3><span class="sub">Tipe request: Iklan</span></div>
      <div class="filters"><label>Jenis<select id="ap-kind"><option value="all">Semua</option><option value="TAMBAH" ${fl.kind === 'TAMBAH' ? 'selected' : ''}>Tambah Iklan</option><option value="UBAH" ${fl.kind === 'UBAH' ? 'selected' : ''}>Ubah Iklan</option></select></label>
        <label>Status<select id="ap-status"><option value="all">Semua</option>${['MENUNGGU', 'DISETUJUI', 'DITOLAK'].map((s) => `<option value="${s}" ${fl.status === s ? 'selected' : ''}>${{ MENUNGGU: 'Menunggu', DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak' }[s]}</option>`).join('')}</select></label></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Jenis</th><th>Nama Campaign</th><th>Pengiklan</th><th>Pengaju</th><th>Diajukan</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((r) => `<tr class="clickable" data-req="${r.id}"><td>${r.kind === 'TAMBAH' ? 'Tambah Iklan' : 'Ubah Iklan'}</td><td><b>${esc(r.campaign.name)}</b></td><td>${esc(r.campaign.advertiserName)}</td><td>${esc(r.makerId)}</td><td class="num">${fmtShort(r.submittedAt)}</td><td>${reqPill(r.status)}</td><td><button class="btn sm" data-req="${r.id}">Detail</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Tidak ada request yang cocok dengan filter.</td></tr>'}
      </tbody></table></div>`;
  }
  function approvalDetailView() {
    const r = srv.listRequests().find((x) => x.id === st.id);
    const c = srv.getCampaign(r.campaignId);
    const own = r.makerId === st.admin;
    let body;
    if (r.kind === 'TAMBAH') {
      body = `<div class="dcard">${Object.keys(FIELD_LABEL).map((k) => `<div class="kv"><span>${FIELD_LABEL[k]}</span><b>${esc(fmtVal(k, r.proposed[k]))}</b></div>`).join('')}
        <div class="kv"><span>Pengiklan</span><b>${esc(c.advertiserName)} · ${esc(c.advertiserPhone)}</b></div><span class="lbl">Materi audio</span><audio controls preload="none" src="${c.media.url}"></audio><span class="sub">${fmtDur(c.media.durationMs)}. Preview tidak dihitung sebagai tayang.</span></div>`;
    } else {
      const keys = Object.keys(FIELD_LABEL).filter((k) => JSON.stringify(r.base[k]) !== JSON.stringify(r.proposed[k]));
      body = `<div class="tbl-wrap"><table class="tbl diff"><thead><tr><th>Field</th><th>Sebelum</th><th>Sesudah</th></tr></thead><tbody>${keys.map((k) => `<tr><td>${FIELD_LABEL[k]}</td><td class="old">${esc(fmtVal(k, r.base[k]))}</td><td class="new">${esc(fmtVal(k, r.proposed[k]))}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const acts = r.status !== 'MENUNGGU' ? `<p class="inline-note">Diproses ${esc(r.checkerId)} · ${fmtDateTime(r.decidedAt)}</p>`
      : own ? '<p class="inline-note">Anda pembuat request ini. Request harus disetujui atau ditolak oleh anggota tim Bisnis lain.</p>'
        : '<button class="btn" data-act="reject">Tolak</button><button class="btn primary" data-act="approve">Setujui</button>';
    return `<div class="adm-h"><button class="btn ghost" data-nav="approval">← Approval</button><h3>${r.kind === 'TAMBAH' ? 'Tambah Iklan' : 'Ubah Iklan'} · ${esc(c.name)}</h3>${reqPill(r.status)}</div>
      <p class="sub">Diajukan ${esc(r.makerId)} · ${fmtDateTime(r.submittedAt)}. Detail hanya baca.</p>${body}<div class="actions">${acts}</div>`;
  }

  // ---------------------------------------------------------- log
  function logView() {
    if (!can('LOG')) return denied('Log');
    const lf = st.logFilter;
    let table;
    if (st.logBox === 'pemutaran') {
      const camps = srv.listCampaigns();
      const rows = srv.listPlaybackLog().filter((p) => (lf.campaign === 'all' || p.campaignId === lf.campaign) && (lf.result === 'all' || p.status === lf.result) && (!lf.mid || p.recipientMid.includes(lf.mid)));
      table = `<div class="filters"><label>Campaign<select id="lg-camp"><option value="all">Semua</option>${camps.map((c) => `<option value="${c.id}" ${lf.campaign === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Hasil<select id="lg-res"><option value="all">Semua</option>${Object.entries(srv.RESULT_LABEL).map(([k, v]) => `<option value="${k}" ${lf.result === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>MID penerima<input id="lg-mid" value="${esc(lf.mid)}" placeholder="cari MID"/></label></div>
        <div class="tbl-wrap"><table class="tbl wide"><thead><tr><th>ID Pemutaran</th><th>Campaign</th><th>Pengiklan</th><th>MID Penerima</th><th>Perangkat</th><th>Transaksi pemicu</th><th>Mulai</th><th>Selesai</th><th>Hasil</th><th>Alasan</th></tr></thead><tbody>
        ${rows.length ? rows.map((p) => `<tr><td class="num">${p.id}</td><td>${esc(p.campaignName)}</td><td>${esc(p.advertiserName)}</td><td class="num">${p.recipientMid}</td><td class="num">${p.deviceId}</td><td class="num">${p.triggerTxIds.join(', ')}</td><td class="num">${p.startedAt ? fmtShort(p.startedAt) : '–'}</td><td class="num">${fmtShort(p.endedAt)}</td><td>${resPill(p.status)}</td><td>${esc(srv.REASON_LABEL[p.reason] || p.reason || '')}</td></tr>`).join('') : '<tr><td colspan="10" class="empty">Belum ada data pemutaran.</td></tr>'}
        </tbody></table></div><p class="note">Pemutaran baru tercatat setelah konfirmasi dari perangkat diterima server. Log tidak dapat diedit atau dihapus.</p>`;
    } else {
      const rows = srv.listAudit();
      const diff = (a) => {
        if (!a.before) return a.after ? Object.entries(a.after).map(([k, v]) => `${FIELD_LABEL[k] || k}: ${fmtVal(k, v)}`).join(' · ') : '';
        return Object.keys({ ...a.before, ...a.after }).filter((k) => JSON.stringify(a.before[k]) !== JSON.stringify(a.after?.[k])).map((k) => `${FIELD_LABEL[k] || k}: ${k === 'status' ? srv.STATUS_LABEL[a.before[k]] : fmtVal(k, a.before[k])} → ${k === 'status' ? srv.STATUS_LABEL[a.after[k]] : fmtVal(k, a.after?.[k])}`).join(' · ');
      };
      table = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Pelaku</th><th>Tindakan</th><th>Campaign</th><th>Sebelum → Sesudah</th></tr></thead><tbody>
        ${rows.length ? rows.map((a) => `<tr><td class="num">${fmtShort(a.at)}</td><td>${esc(a.actor)}</td><td>${a.action.replace(/_/g, ' ').toLowerCase()}</td><td>${esc(a.campaignName)}</td><td class="sub">${esc(diff(a))}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Belum ada perubahan setting iklan. Coba Pause, Edit, atau Tambah Iklan.</td></tr>'}
        </tbody></table></div><p class="note">Hanya perubahan yang berhasil tersimpan yang tercatat. Riwayat tidak dapat diedit.</p>`;
    }
    return `<div class="adm-h"><h3>Log</h3><div class="seg">${[['pemutaran', 'Pemutaran Iklan'], ['setting', 'Setting Iklan']].map(([k, l]) => `<button data-logbox="${k}" class="${st.logBox === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>${table}`;
  }

  // ---------------------------------------------------------- render
  function render() {
    let body;
    if (st.view === 'list') body = listView();
    else if (st.view === 'detail') body = detailView();
    else if (st.view === 'add' || st.view === 'edit') body = formView(st.view);
    else if (st.view === 'approval') body = approvalView();
    else if (st.view === 'approvalDetail') body = approvalDetailView();
    else body = logView();
    root.innerHTML = nav() + `<div class="adm-body">${body}</div>`;
  }
  const flash = (text, tone = 'ok') => { st.msg = { text, tone }; render(); setTimeout(() => { if (st.msg?.text === text) { st.msg = null; if (!busy()) render(); } }, 4000); };
  const busy = () => [...root.querySelectorAll('audio')].some((a) => !a.paused) || ['add', 'edit'].includes(st.view) || (st.pauseOpen && root.contains(document.activeElement)) || (root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea'));
  function go(view, id) { st.view = view; if (id) st.id = id; st.pauseOpen = false; if (view === 'add' || view === 'edit') st.form = newForm(view); render(); }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button, tr.clickable'); if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.nav) return go(d.nav === 'list' ? 'list' : d.nav);
    if (d.go) return go(d.go === 'detail' ? 'detail' : d.go);
    if (d.open) return go('detail', d.open);
    if (d.req) return go('approvalDetail', d.req);
    if (d.logbox) { st.logBox = d.logbox; return render(); }
    if (d.mid) { readForm(); st.form.midChanged = st.form.baseMid !== undefined && d.mid !== st.form.baseMid; st.form.advertiserMid = d.mid; st.form.midQuery = ''; st.form.excludeSelf = st.form.midChanged ? false : st.form.excludeSelf; return render(); }
    if (d.mcc) { readForm(); st.form.mcc.push(d.mcc); st.form.mccQuery = ''; render(); root.querySelector('#f-mccq')?.focus(); return; }
    if (d.mccDel) { readForm(); st.form.mcc = st.form.mcc.filter((x) => x !== d.mccDel); return render(); }
    const a = d.act;
    try {
      if (a === 'mid-clear') { readForm(); st.form.advertiserMid = null; st.form.excludeSelf = false; st.form.midChanged = false; render(); }
      else if (a === 'sample') { readForm(); st.form.media = makeSampleAd('c', 12); st.form.fileError = ''; render(); }
      else if (a === 'pause-open') { st.pauseOpen = true; render(); root.querySelector('#pause-reason')?.focus(); }
      else if (a === 'pause-cancel') { st.pauseOpen = false; render(); }
      else if (a === 'resume') { srv.resume(st.id, st.admin); flash('Campaign di-resume.'); }
      else if (a === 'approve' || a === 'reject') {
        const r = srv.listRequests().find((x) => x.id === st.id);
        srv.decide(st.id, st.admin, a);
        flash(a === 'approve' ? 'Request disetujui.' : 'Request ditolak.');
        st.id = r.id; render();
      }
    } catch (err) { flash(err.message, 'err'); }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'f-mid' || e.target.id === 'f-mccq') {
      readForm(); const id = e.target.id; const pos = e.target.selectionStart; render();
      const el = root.querySelector('#' + id); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }
    if (e.target.id === 'pause-reason') root.querySelector('#pause-count').textContent = `${e.target.value.length}/255`;
    if (e.target.id === 'lg-mid') { st.logFilter.mid = e.target.value.trim(); const pos = e.target.selectionStart; render(); const el = root.querySelector('#lg-mid'); el.focus(); el.setSelectionRange(pos, pos); }
  });
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'adm-user') { st.admin = t.value; const sec = st.view.startsWith('approval') ? 'APPROVAL' : st.view === 'log' ? 'LOG' : 'IKLAN'; if (!can(sec)) st.view = can('IKLAN') ? 'list' : can('APPROVAL') ? 'approval' : 'log'; if (['add', 'edit'].includes(st.view)) st.view = 'list'; return render(); }
    if (t.id === 'ap-kind') { st.approvalFilter.kind = t.value; return render(); }
    if (t.id === 'ap-status') { st.approvalFilter.status = t.value; return render(); }
    if (t.id === 'lg-camp') { st.logFilter.campaign = t.value; return render(); }
    if (t.id === 'lg-res') { st.logFilter.result = t.value; return render(); }
    if (t.id === 'f-file') {
      readForm();
      const file = t.files[0]; st.form.fileError = ''; st.form.media = null;
      if (file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['m4a', 'mp3', 'wav'].includes(ext)) st.form.fileError = 'Format tidak didukung. Gunakan M4A, MP3, atau WAV.';
        else if (file.size > 5 * 1024 * 1024) st.form.fileError = `Ukuran file ${(file.size / 1048576).toFixed(1).replace('.', ',')} MB melebihi batas 5 MB.`;
        else {
          try {
            const buf = await file.arrayBuffer();
            const decoded = await new AudioContext().decodeAudioData(buf.slice(0));
            st.form.media = { url: URL.createObjectURL(file), size: file.size, durationMs: Math.round(decoded.duration * 1000), format: ext.toUpperCase(), fileName: file.name };
          } catch { st.form.fileError = 'File rusak atau tidak bisa dibaca. Pilih file lain.'; }
        }
      }
      render();
    }
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'pause-form') {
      const reason = root.querySelector('#pause-reason').value;
      try { srv.pause(st.id, st.admin, reason); st.pauseOpen = false; flash('Campaign di-pause. Audio yang sedang berbunyi dibiarkan selesai.'); }
      catch (err) { root.querySelector('#pause-err').textContent = err.fields?.reason || err.message; }
      return;
    }
    if (e.target.id === 'ad-form') {
      readForm(); const f = st.form;
      const input = { name: f.name, startAt: f.start ? fromWibInput(f.start) : null, endAt: f.end ? fromWibInput(f.end) : null, advertiserMid: f.advertiserMid, excludeSelf: f.excludeSelf, mccExclusions: f.mcc };
      try {
        if (st.view === 'add') {
          const c = srv.addCampaign({ ...input, advertiserName: f.advertiserName, advertiserPhone: f.advertiserPhone, media: f.media }, st.admin);
          st.view = 'detail'; st.id = c.id; flash('Iklan tersimpan dengan status Menunggu Persetujuan. Minta anggota tim Bisnis lain menyetujuinya di menu Approval.');
        } else {
          srv.editCampaign(st.id, { ...input, excludeSelfConfirmed: true }, st.admin);
          st.view = 'detail'; flash('Perubahan diajukan dan menunggu persetujuan.');
        }
      } catch (err) {
        if (err.fields) { f.errors = err.fields; render(); } else flash(err.message, 'err');
      }
    }
  });

  on((m) => { if ((m.kind === 'fact' && /^(admin|srv\.result|srv\.gate)/.test(m.f.type)) || m.kind === 'clock') if (!busy()) render(); });
  setInterval(() => { if (!busy() && ['list', 'detail', 'log'].includes(st.view)) render(); }, 3000);
  render();
  return { render, setAdmin(id) { st.admin = id; render(); }, go };
}
