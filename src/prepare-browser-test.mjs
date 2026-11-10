// Menyiapkan halaman uji untuk screenshot headless (terang, gelap, dan keadaan "Tiny").
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, '_verify');
await mkdir(out, { recursive: true });
await rm(join(out, 'dom.html'), { force: true });

const html = await readFile(join(root, 'index.html'), 'utf8');
const URL1 = 'https://contoh.com/halaman-keren?ref=qrcode';

// Skrip pengisi otomatis + probe hasil (dibaca dari DOM yang di-dump bila perlu)
function inject(body) {
  return `
<script>
  window.__errors = [];
  window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
  setTimeout(function () {
    var t = document.getElementById('content');
    t.value = ${JSON.stringify(URL1)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(function () {
      ${body}
      var d = document.createElement('div');
      d.id = 'probe';
      d.textContent = JSON.stringify({
        errors: window.__errors,
        canvasHidden: document.getElementById('canvas').hidden,
        copyDisabled: document.getElementById('copyBtn').disabled,
        size: document.getElementById('m-size').textContent,
        version: document.getElementById('m-version').textContent,
        modules: document.getElementById('m-modules').textContent,
        modulepx: document.getElementById('m-modulepx').textContent,
        warn: document.getElementById('warn').hidden ? null : document.getElementById('warn-text').textContent,
        err: document.getElementById('err').hidden ? null : document.getElementById('err-text').textContent,
        jsQrcodeLoaded: typeof qrcode === 'function'
      });
      document.body.appendChild(d);
    }, 500);
  }, 100);
<\/script>
`;
}

const pickTiny = `
      document.querySelectorAll('.size')[3].click();
      document.querySelector('details.adv').open = true;
`;

// Keadaan peringatan: link panjang di Tiny + latar transparan (dua catatan sekaligus)
const LONG = 'https://contoh.com/' + 'panjang-'.repeat(20);
const pickWarn = `
      var t2 = document.getElementById('content');
      t2.value = ${JSON.stringify(LONG)};
      t2.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelectorAll('.size')[3].click();
      document.querySelector('details.adv').open = true;
      var tp = document.getElementById('transparent');
      tp.checked = true;
      tp.dispatchEvent(new Event('change', { bubbles: true }));
`;

await writeFile(join(out, 'preview.html'), html.replace('</body>', inject('') + '</body>'), 'utf8');
await writeFile(join(out, 'preview-tiny.html'), html.replace('</body>', inject(pickTiny) + '</body>'), 'utf8');
await writeFile(join(out, 'preview-warn.html'), html.replace('</body>', inject(pickWarn) + '</body>'), 'utf8');

// Mode gelap: paksa media query prefers-color-scheme: dark menjadi aktif
const dark = html.replace(/@media \(prefers-color-scheme: dark\)/g, '@media all');
if (dark === html) throw new Error('tidak menemukan media query mode gelap');
await writeFile(join(out, 'preview-dark.html'), dark.replace('</body>', inject('') + '</body>'), 'utf8');

console.log('OK → _verify/preview.html, preview-tiny.html, preview-dark.html');

/* ---------- Probe lingkungan clipboard di file:// ---------- */
const probe = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>clipboard probe</title></head><body>
<div id="probe">menunggu…</div>
<script>
(function () {
  var info = {
    url: location.href,
    isSecureContext: window.isSecureContext,
    hasClipboardApi: typeof navigator.clipboard,
    hasWrite: !!(navigator.clipboard && navigator.clipboard.write),
    hasReadText: !!(navigator.clipboard && navigator.clipboard.readText),
    hasClipboardItem: typeof ClipboardItem,
    copyError: null,
    copyOk: null
  };
  function done() { document.getElementById('probe').textContent = 'PROBE:' + JSON.stringify(info); }
  try {
    // PNG 1x1 sungguhan
    var b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var blob = new Blob([arr], { type: 'image/png' });
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
        info.copyOk = true; done();
      }, function (e) {
        info.copyOk = false; info.copyError = (e && e.name) + ': ' + (e && e.message); done();
      });
    } else { done(); }
  } catch (e) {
    info.copyError = 'throw ' + e.name + ': ' + e.message; done();
  }
})();
<\/script></body></html>`;
await writeFile(join(out, 'clip-probe.html'), probe, 'utf8');
console.log('OK → _verify/clip-probe.html');
