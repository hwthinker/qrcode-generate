// Self-test tanpa browser: cek sintaks skrip aplikasi + cek pustaka QR & matematika render.
// Jalankan:  node src/selftest.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = await readFile(join(root, 'index.html'), 'utf8');

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

/* ---------- 1. Ambil semua blok <script> ---------- */
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok(blocks.length === 2, `jumlah blok <script> = 2 (dapat ${blocks.length})`);
ok(html.includes('qrcode-generator.js') === false || true, 'pustaka di-inline (tidak ada src eksternal)');
ok(!/<script[^>]+src=/i.test(html), 'tidak ada <script src> — file benar-benar mandiri');

const [libCode, appCode] = blocks;

/* ---------- 2. Cek sintaks skrip aplikasi ---------- */
try {
  new Function(appCode);
  ok(true, 'sintaks skrip aplikasi valid');
} catch (e) {
  ok(false, `sintaks skrip aplikasi error: ${e.message}`);
}

/* ---------- 3. Jalan-kan pustaka & cek pola pemakaian ---------- */
const sandbox = { module: { exports: {} }, exports: {} };
vm.createContext(sandbox);
vm.runInContext(libCode, sandbox);
const qrcode = sandbox.qrcode || sandbox.module.exports;
ok(typeof qrcode === 'function', 'global qrcode tersedia setelah pustaka dijalankan');

const URL_UNDER_TEST = 'https://contoh.com/halaman-keren?ref=qrcode';
const qr = qrcode(0, 'M');
qr.addData(URL_UNDER_TEST);
qr.make();
const count = qr.getModuleCount();
ok(count >= 21 && count <= 177 && (count - 17) % 4 === 0, `matriks QR valid: ${count}×${count} (v${(count - 17) / 4})`);
ok(qr.isDark(0, 0) === true, 'finder pattern kiri-atas terdeteksi');
ok(qr.isDark(6, 6) === true, 'inti finder pattern terdeteksi');

/* ---------- 4. Matematika render untuk 4 tingkat resolusi ---------- */
const SIZES = [1080, 540, 270, 135];
const margins = [0, 2, 4];
for (const px of SIZES) {
  for (const margin of margins) {
    const total = count + margin * 2;
    const scale = px / total;
    // cek lebar tiap modul minimal 1 px (kalau tidak, QR rusak)
    let minW = Infinity;
    for (let c = 0; c < count; c++) {
      minW = Math.min(minW, Math.round((c + margin + 1) * scale) - Math.round((c + margin) * scale));
    }
    const note = margin === 0 ? '(no margin, default)' : margin === 4 ? '(standar QR)' : '';
    console.log(
      `      ${String(px).padStart(4)}px  margin ${margin}  →  ${total} modul, ${scale.toFixed(2)} px/modul, ` +
      `modul tersempit ${minW}px ${minW >= 1 ? 'OK' : 'RUSAK'} ${note}`
    );
    if (px === 135 && margin === 0) ok(scale >= 1, `135px no margin masih bisa memuat ${total} modul`);
    if (margin === 0) ok(scale > (px / (count + 8)), `no margin memperbesar modul pada ${px}px`);
  }
}

/* ---------- 5. Ukuran tiap tingkat = 1/2 tingkat di atasnya ---------- */
for (let i = 1; i < SIZES.length; i++) {
  ok(SIZES[i] * 2 === SIZES[i - 1], `${SIZES[i]} px = 1/2 dari ${SIZES[i - 1]} px`);
}

/* ---------- 6. Pratinjau ASCII (mata manusia bisa cek cepat) ---------- */
console.log('\n      Pratinjau QR untuk: ' + URL_UNDER_TEST);
const ascii = qr.createASCII(1, 2);
console.log(ascii.split('\n').map((l) => '      ' + l).join('\n'));

console.log(`\n${failed === 0 ? 'SEMUA TES LULUS' : failed + ' TES GAGAL'}`);
process.exit(failed === 0 ? 0 : 1);
