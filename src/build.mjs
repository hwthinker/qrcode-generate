// Build: gabungkan template aplikasi + pustaka QR menjadi satu file HTML mandiri.
// Jalankan:  node src/build.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const MARKER = '/*__QRCODE_LIB__*/';

const template = await readFile(join(here, 'app.template.html'), 'utf8');
const lib = await readFile(join(root, 'vendor', 'qrcode-generator.js'), 'utf8');

const hits = template.split(MARKER).length - 1;
if (hits !== 1) {
  console.error(`GAGAL: marker ${MARKER} ditemukan ${hits}× (harus tepat 1×).`);
  process.exit(1);
}
if (/<\/script/i.test(lib)) {
  console.error('GAGAL: pustaka mengandung "</script" sehingga tidak aman di-inline.');
  process.exit(1);
}

const banner =
  '<!-- Dibangun otomatis oleh src/build.mjs — jangan diedit langsung.\n' +
  '     Sumber: src/app.template.html + vendor/qrcode-generator.js (MIT, Kazuhiko Arase). -->\n';

// Banner ditaruh setelah DOCTYPE supaya tidak ada apa pun sebelum doctype.
const out = template
  .replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + banner.trimEnd())
  .replace(MARKER, () => lib);
await writeFile(join(root, 'index.html'), out, 'utf8');

console.log(`OK → index.html (${out.length} byte, pustaka ${lib.length} byte)`);
