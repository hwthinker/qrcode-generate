// Uji integrasi: menjalankan skrip aplikasi dari index.html di atas DOM tiruan,
// lalu memeriksa piksel canvas yang benar-benar dihasilkan aplikasi.
// Jalankan:  node src/dom-test.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, '_verify');
await mkdir(outDir, { recursive: true });

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
  return cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => {
  console.log('FAIL  promise ditolak tanpa penanganan: ' + ((e && e.stack) || e));
  failed++;
});

/* ================= PNG encoder (untuk memeriksa & melihat hasil) ================= */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ================= DOM tiruan ================= */
const parseColor = (css) => {
  const named = { black: [0, 0, 0, 255], white: [255, 255, 255, 255] };
  if (named[css]) return named[css];
  const m = /^#([0-9a-f]{6})$/i.exec(String(css).trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  throw new Error('warna tidak dikenal: ' + css);
};

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
}

class FakeCanvas {
  constructor() { this._w = 300; this._h = 150; this.hidden = false; this.style = {}; this.classList = new ClassList(); this.listeners = {}; this.buffer = new Uint8ClampedArray(300 * 150 * 4); }
  get width() { return this._w; }
  set width(v) { this._w = v; this._alloc(); }
  get height() { return this._h; }
  set height(v) { this._h = v; this._alloc(); }
  _alloc() { this.buffer = new Uint8ClampedArray(this._w * this._h * 4); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  focus() {}
  getContext() {
    const self = this;
    let fill = [0, 0, 0, 255];
    const put = (x, y, w, h, rgba) => {
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(self._w, Math.round(x + w)), y1 = Math.min(self._h, Math.round(y + h));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * self._w + xx) * 4;
          self.buffer[i] = rgba[0]; self.buffer[i + 1] = rgba[1];
          self.buffer[i + 2] = rgba[2]; self.buffer[i + 3] = rgba[3];
        }
      }
    };
    return {
      set fillStyle(v) { fill = parseColor(v); },
      get fillStyle() { return fill; },
      clearRect: (x, y, w, h) => put(x, y, w, h, [0, 0, 0, 0]),
      fillRect: (x, y, w, h) => put(x, y, w, h, fill)
    };
  }
  toPng() { return encodePng(this.buffer, this._w, this._h); }
  toDataURL() { return 'data:image/png;base64,' + this.toPng().toString('base64'); }
  toBlob(cb) { const b = this.toPng(); cb({ type: 'image/png', size: b.length, bytes: b }); }
  pixel(x, y) { const i = (y * this._w + x) * 4; return [this.buffer[i], this.buffer[i + 1], this.buffer[i + 2], this.buffer[i + 3]]; }
}

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id;
    this.style = {}; this.classList = new ClassList(); this.attributes = {};
    this.children = []; this.parentNode = null; this.listeners = {};
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.tabIndex = 0; this.scrollHeight = 120; this._text = ''; this._html = '';
  }
  get textContent() {
    if (this._text !== '') return this._text;
    return String(this._html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
  set textContent(v) { this._text = String(v); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, ...extra };
    let node = this;
    while (node) {
      (node.listeners[type] || []).forEach((fn) => fn.call(node, ev));
      node = node.parentNode;
    }
    return ev;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  focus() {}
  click() { this.dispatch('click'); }
  closest(sel) {
    if (sel === '.size' && this.classList.contains('size')) return this;
    return this.parentNode ? this.parentNode.closest(sel) : null;
  }
  querySelectorAll(sel) {
    const all = [];
    const walk = (n) => { n.children.forEach((c) => { all.push(c); walk(c); }); };
    walk(this);
    if (sel === '.size') return all.filter((e) => e.classList.contains('size'));
    return [];
  }
  querySelector(sel) {
    const m = /^\[data-size="(.+)"\]$/.exec(sel);
    if (m) return this.querySelectorAll('.size').find((e) => e.getAttribute('data-size') === m[1]) || null;
    return null;
  }
  set innerHTML(html) {
    this._html = html;
    this.children = [];
    // cukup untuk kasus #sizes: bikin tombol tiruan dari markup yang dihasilkan aplikasi
    for (const m of String(html).matchAll(/data-size="([a-z]+)"/g)) {
      const btn = new El('button');
      btn.classList.add('size');
      btn.setAttribute('data-size', m[1]);
      ['dot', 'nm', 'px', 'nt'].forEach((cls) => { const s = new El('span'); s.classList.add(cls); btn.appendChild(s); });
      this.appendChild(btn);
    }
  }
  get innerHTML() { return this._html; }
}

const ids = ['content', 'counter', 'sizes', 'ec', 'margin', 'dark', 'light', 'transparent', 'autoHttps',
  'canvas', 'empty', 'stage', 'badge', 'foot', 'copyBtn', 'downloadBtn', 'pasteBtn', 'clearBtn',
  'resetBtn', 'toast', 'warn', 'warn-text', 'err', 'err-text',
  'm-size', 'm-version', 'm-modules', 'm-ec', 'm-margin', 'm-modulepx'];

const registry = new Map();
for (const id of ids) registry.set(id, id === 'canvas' ? new FakeCanvas() : new El('div', id));
const body = new El('body');
const docListeners = {};
const document = {
  body,
  getElementById: (id) => registry.get(id) || null,
  querySelector: () => null,
  createElement: (tag) => new El(tag),
  createRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {} }),
  addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
  execCommand: () => true,
  dispatch(type, extra) { (docListeners[type] || []).forEach((fn) => fn({ type, preventDefault() {}, ...extra })); }
};
const store = new Map();
const clipboardCalls = [];
class FakeClipboardItem { constructor(o) { this.o = o; } }
const sandbox = {
  document,
  window: {
    addEventListener() {}, getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    ClipboardItem: FakeClipboardItem
  },
  ClipboardItem: FakeClipboardItem,
  navigator: { clipboard: { write: async (items) => { clipboardCalls.push(items); }, readText: async () => 'https://dari.clipboard/x' } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  },
  setTimeout, clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 0),
  Event: class { constructor(t) { this.type = t; } },
  console, Math, Date, JSON, parseInt, parseFloat, String, Number, Object, Array, RegExp, Error
};

/* ================= Jalankan aplikasi yang sebenarnya ================= */
const html = await readFile(join(root, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok(blocks.length === 2, 'index.html punya 2 blok skrip (pustaka + aplikasi)');

vm.createContext(sandbox);
vm.runInContext(blocks[0], sandbox, { filename: 'qrcode-generator.js' });
let bootError = null;
try {
  vm.runInContext(blocks[1], sandbox, { filename: 'app.js' });
} catch (e) { bootError = e; }
ok(!bootError, 'aplikasi jalan tanpa error saat dimuat' + (bootError ? ` → ${bootError.message}` : ''));

const el = (id) => registry.get(id);
const canvas = el('canvas');
const appQrcode = sandbox.qrcode;

const sizeBtn = (id) => el('sizes').querySelectorAll('.size').find((b) => b.getAttribute('data-size') === id);
// klik lewat anak <span> supaya jalur ev.target.closest('.size') ikut teruji
const pickSize = (id) => sizeBtn(id).children[1].dispatch('click');
async function setContent(text) {
  el('content').value = text;
  el('content').dispatch('input');
  await sleep(260);
}

/* ================= 1. Kondisi awal ================= */
ok(canvas.hidden === true, 'canvas tersembunyi saat belum ada isi');
ok(el('copyBtn').disabled === true && el('downloadBtn').disabled === true, 'tombol copy & download nonaktif saat kosong');
ok(el('m-size').textContent === '—', 'info ukuran masih "—" saat kosong');

/* ================= 2. Isi link → QR muncul ================= */
const URL1 = 'https://contoh.com/halaman-keren?ref=qrcode';
el('content').value = URL1;
el('content').dispatch('input');
await sleep(260);

ok(canvas.hidden === false, 'canvas tampil setelah link diisi');
ok(el('copyBtn').disabled === false, 'tombol copy aktif');
ok(el('m-size').textContent === '1080 × 1080 px', `resolusi awal = 1080 px (dapat "${el('m-size').textContent}")`);
ok(el('m-ec').textContent === 'M · 15%', 'koreksi error awal = M');
ok(el('m-margin').textContent === '0 modul', 'margin awal = No margin / 0 modul (default baru)');
ok(el('badge').textContent === '1080 × 1080 px', 'badge menampilkan 1080 × 1080 px');

/* ================= 3. Kesetiaan piksel di semua tingkat ================= */
function expectedMatrix(content, ec) {
  const q = appQrcode(0, ec);
  q.addData(content);
  q.make();
  return q;
}
function checkPixels(px, margin, content, ec, label) {
  const q = expectedMatrix(content, ec);
  const count = q.getModuleCount();
  const total = count + margin * 2;
  const scale = px / total;
  let mismatches = 0;
  let dark = 0;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      const x = Math.floor((c + margin + 0.5) * scale);
      const y = Math.floor((r + margin + 0.5) * scale);
      const [pr, pg, pb] = canvas.pixel(x, y);
      const isDarkPixel = pr < 128 && pg < 128 && pb < 128;
      if (isDarkPixel !== q.isDark(r, c)) mismatches++;
      if (q.isDark(r, c)) dark++;
    }
  }
  // quiet zone harus bersih
  let quietDirty = 0;
  if (margin > 0) {
    for (let i = 0; i < px; i++) {
      if (canvas.pixel(i, 0)[3] !== 0 && canvas.pixel(i, 0)[0] < 200) quietDirty++;
      if (canvas.pixel(0, i)[0] < 200) quietDirty++;
    }
  }
  ok(mismatches === 0, `${label}: ${count}×${count} modul tergambar tepat (${dark} modul gelap, ${mismatches} salah)`);
  ok(quietDirty === 0, `${label}: quiet zone ${margin} modul bersih`);
  return q;
}

const SIZE_CASES = [
  ['max', 1080], ['standard', 540], ['small', 270], ['tiny', 135]
];
for (const [id, px] of SIZE_CASES) {
  pickSize(id);
  await sleep(30);
  ok(canvas.width === px && canvas.height === px, `klik "${id}" → canvas ${canvas.width}×${canvas.height} px`);
  checkPixels(px, 0, URL1, 'M', `${px}px (no margin, default)`);
  const png = canvas.toPng();
  await writeFile(join(outDir, `qr-${px}.png`), png);
  console.log(`      → _verify/qr-${px}.png (${png.length} byte)`);
}

/* ================= 4. Normalisasi link ================= */
pickSize('max');
await setContent('contoh.com/tanpa-protokol');
checkPixels(1080, 0, 'https://contoh.com/tanpa-protokol', 'M', 'auto https://');

await setContent('mailto:halo@contoh.com');
checkPixels(1080, 0, 'mailto:halo@contoh.com', 'M', 'skema mailto: tidak diubah');

await setContent('Halo dunia tanpa titik');
checkPixels(1080, 0, 'Halo dunia tanpa titik', 'M', 'teks biasa tidak ditambah https://');

await setContent('https://sudah-ada-protokol.example/x');
checkPixels(1080, 0, 'https://sudah-ada-protokol.example/x', 'M', 'protokol yang sudah ada tidak diduplikasi');

/* ================= 5. Margin & koreksi error ================= */
await setContent(URL1);

el('margin').value = '4';
el('margin').dispatch('change');
await sleep(60);
ok(el('m-margin').textContent === '4 modul', 'opsi "4 modul (standar QR)" diterapkan');
checkPixels(1080, 4, URL1, 'M', 'margin 4 modul');

el('margin').value = '0';
el('margin').dispatch('change');
await sleep(60);
ok(el('m-margin').textContent === '0 modul', 'opsi "No margin" diterapkan');
ok(parseFloat(el('m-modulepx').textContent) > 30,
  `no margin memperbesar modul (${el('m-modulepx').textContent} vs 26.3 px saat margin 4 modul)`);
checkPixels(1080, 0, URL1, 'M', 'no margin');

el('ec').value = 'H';
el('ec').dispatch('change');
await sleep(60);
ok(el('m-ec').textContent === 'H · 30%', 'koreksi error H diterapkan');
checkPixels(1080, 0, URL1, 'H', 'koreksi H');

el('resetBtn').dispatch('click');
await sleep(60);
ok(el('ec').value === 'M' && el('margin').value === '0', 'tombol reset kembali ke default (No margin)');
checkPixels(1080, 0, URL1, 'M', 'setelah reset');

/* ================= 6. Warna & latar transparan ================= */
el('dark').value = '#ff0000';
el('dark').dispatch('input');
await sleep(260);
{
  const q = expectedMatrix(URL1, 'M');
  const px = 1080, margin = parseInt(el('margin').value, 10), total = q.getModuleCount() + margin * 2, scale = px / total;
  // cari modul gelap pertama
  let found = null;
  for (let r = 0; r < q.getModuleCount() && !found; r++)
    for (let c = 0; c < q.getModuleCount() && !found; c++)
      if (q.isDark(r, c)) found = [Math.floor((c + margin + 0.5) * scale), Math.floor((r + margin + 0.5) * scale)];
  const [pr, pg, pb] = canvas.pixel(found[0], found[1]);
  ok(pr > 200 && pg < 60 && pb < 60, `warna QR kustom diterapkan (rgb ${pr},${pg},${pb})`);
}

el('transparent').checked = true;
el('transparent').dispatch('change');
await sleep(260);
ok(/tanpa margin/.test(el('warn-text').innerHTML), 'peringatan khusus "latar transparan + no margin" muncul');
console.log(`      → peringatan: "${el('warn-text').textContent.replace(/\s+/g, ' ').slice(0, 105)}…"`);
ok(el('m-size').textContent === '1080 × 1080 px', 'ukuran tetap 1080 px saat transparan');
{
  const q = expectedMatrix(URL1, 'M');
  const px = 1080, margin = parseInt(el('margin').value, 10), total = q.getModuleCount() + margin * 2, scale = px / total;
  let lightPt = null, darkPt = null;
  for (let r = 0; r < q.getModuleCount(); r++)
    for (let c = 0; c < q.getModuleCount(); c++) {
      const x = Math.floor((c + margin + 0.5) * scale), y = Math.floor((r + margin + 0.5) * scale);
      if (q.isDark(r, c)) { if (!darkPt) darkPt = [x, y]; } else if (!lightPt) lightPt = [x, y];
    }
  // tanpa margin, sudut gambar adalah bagian QR — jadi uji transparansi lewat modul terang
  ok(canvas.pixel(lightPt[0], lightPt[1])[3] === 0, 'latar transparan: modul terang jadi transparan (alpha 0)');
  ok(canvas.pixel(darkPt[0], darkPt[1])[3] === 255, 'modul gelap tetap pekat (alpha 255)');
  let mismatch = 0;
  for (let r = 0; r < q.getModuleCount(); r++)
    for (let c = 0; c < q.getModuleCount(); c++) {
      const x = Math.floor((c + margin + 0.5) * scale), y = Math.floor((r + margin + 0.5) * scale);
      const [pr, pg, pb, pa] = canvas.pixel(x, y);
      const dark = pa === 255 && pr > 200 && pg < 60;
      if (dark !== q.isDark(r, c)) mismatch++;
    }
  ok(mismatch === 0, `transparan + warna merah tetap setia ke matriks (${mismatch} salah)`);
}
const transparentPng = canvas.toPng();
await writeFile(join(outDir, 'qr-1080-transparan-merah.png'), transparentPng);
console.log(`      → _verify/qr-1080-transparan-merah.png (${transparentPng.length} byte)`);

el('transparent').checked = false;
el('transparent').dispatch('change');
el('dark').value = '#0b1020';
el('dark').dispatch('input');
await sleep(260);

/* ================= 7. Konten terlalu panjang untuk 135 px ================= */
await setContent('https://contoh.com/' + 'sangat-panjang-'.repeat(120));
pickSize('tiny');
await sleep(260);
ok(el('err').hidden === false, 'resolusi terlalu kecil → pesan error tampil');
ok(/modul/.test(el('err-text').innerHTML), 'pesan error menjelaskan kebutuhan modul');
ok(canvas.hidden === true && el('copyBtn').disabled === true, 'canvas disembunyikan & tombol copy nonaktif saat error');
ok(el('err-text').innerHTML.length > 80, 'pesan error memberi saran konkret');

/* ================= 7b. QR padat tapi masih muat → peringatan ================= */
el('margin').value = '4';
el('margin').dispatch('change');
await setContent('https://contoh.com/' + 'panjang-'.repeat(20));
pickSize('tiny');
await sleep(260);
ok(el('err').hidden === true, 'konten ini masih muat di 135 px (tidak error)');
ok(el('warn').hidden === false, 'QR padat → peringatan tampil');
ok(/modul hanya/.test(el('warn-text').innerHTML), 'peringatan menjelaskan ukuran modul per piksel');
console.log(`      → peringatan: "${el('warn-text').textContent.replace(/\s+/g, ' ').slice(0, 110)}…"`);

/* ================= 8. Copy gambar ke clipboard ================= */
pickSize('max');
await setContent(URL1);
el('copyBtn').dispatch('click');
await sleep(150);
ok(clipboardCalls.length === 1, 'navigator.clipboard.write dipanggil sekali');
if (clipboardCalls.length) {
  const item = clipboardCalls[0][0];
  const blob = item.o['image/png'];
  ok(blob && blob.type === 'image/png' && blob.size > 1000, `blob PNG dikirim ke clipboard (${blob ? blob.size : 0} byte)`);
}
const toasts = el('toast').children;
const lastToast = toasts.length ? toasts[toasts.length - 1].textContent : '(tidak ada)';
ok(toasts.length > 0 && /tersalin/.test(lastToast), `toast konfirmasi muncul: "${lastToast}"`);
ok(/1080/.test(lastToast), 'toast menyebut resolusi gambar yang disalin');

/* ================= 9. Jalur cadangan saat clipboard.write ditolak ================= */
{
  const realWrite = sandbox.navigator.clipboard.write;
  const before = el('toast').children.length;
  sandbox.navigator.clipboard.write = async () => { const e = new Error('Write permission denied.'); e.name = 'NotAllowedError'; throw e; };
  el('copyBtn').dispatch('click');
  await sleep(150);
  const toasts2 = el('toast').children;
  const msg = toasts2.length > before ? toasts2[toasts2.length - 1].textContent : '(tidak ada)';
  ok(/kompatibilitas/.test(msg), `clipboard.write ditolak → jalur cadangan dipakai: "${msg}"`);
  sandbox.navigator.clipboard.write = realWrite;
}

/* ================= 10. Tempel dari clipboard & hapus ================= */
el('pasteBtn').dispatch('click');
await sleep(80);
ok(el('content').value === 'https://dari.clipboard/x', 'tombol "Tempel dari clipboard" mengisi kotak teks');
await sleep(200);
ok(canvas.hidden === false, 'QR dibuat ulang dari isi clipboard');

el('clearBtn').dispatch('click');
await sleep(60);
ok(el('content').value === '' && canvas.hidden === true, 'tombol "Hapus" mengosongkan dan menyembunyikan QR');
ok(el('counter').textContent === '0 karakter · 0 byte', `penghitung karakter ikut reset ("${el('counter').textContent}")`);

/* ================= 11. Simpan & muat ulang pengaturan ================= */
await setContent('https://tersimpan.example/abc');
await sleep(500);
ok(store.has('qrgen.v1'), 'pengaturan & isi disimpan ke localStorage');
if (store.has('qrgen.v1')) {
  const saved = JSON.parse(store.get('qrgen.v1'));
  ok(saved.text === 'https://tersimpan.example/abc' && saved.state.sizeId === 'max', 'isi tersimpan lengkap (teks + pengaturan)');
}

console.log(`\n${failed === 0 ? 'SEMUA TES LULUS' : failed + ' TES GAGAL'}`);
process.exit(failed === 0 ? 0 : 1);
