// Bundle src/ menjadi satu file HTML mandiri.
//   dist/index.html       → isi halaman (dipublish sebagai Artifact)
//   dist/standalone.html  → bisa dibuka langsung di browser (double-click)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';

const out = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: 'es2020', write: false, minify: false, loader: { '.wav': 'dataurl' }, legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/styles.css', 'utf8');
const page = readFileSync('src/template.html', 'utf8').replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', page);
writeFileSync('dist/standalone.html', `<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>[hidden]{display:none!important}body{margin:0}</style>\n</head>\n<body>\n${page}\n</body>\n</html>\n`);
// dist/site → folder yang di-deploy ke Cloudflare (halaman lengkap + service worker FCM)
mkdirSync('dist/site', { recursive: true });
copyFileSync('dist/standalone.html', 'dist/site/index.html');
copyFileSync('src/firebase-messaging-sw.js', 'dist/site/firebase-messaging-sw.js');
console.log(`dist/index.html ${(page.length / 1024).toFixed(0)} KB`);
