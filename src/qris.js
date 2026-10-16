// QRIS asli (EMV TLV) → QR sungguhan yang bisa dipindai, plus info merchant dari isinya.
import qrcode from 'qrcode-generator';

export function parseTlv(s) {
  const out = {}; let i = 0;
  while (i + 4 <= s.length) { const len = Number(s.slice(i + 2, i + 4)); out[s.slice(i, i + 2)] = s.slice(i + 4, i + 4 + len); i += 4 + len; }
  return out;
}
export function qrisInfo(raw) {
  const t = parseTlv(raw), t51 = parseTlv(t['51'] || '');
  return { name: (t['59'] || '').trim(), city: (t['60'] || '').trim(), nmid: t51['02'] || '', mcc: t['52'] || '' };
}
export function qrSvgReal(raw) {
  const q = qrcode(0, 'M'); q.addData(raw); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace('<svg', '<svg class="qr real" role="img" aria-label="QRIS"');
}
