// Empacota o build de demonstração num único HTML (JS, CSS e fontes embutidos) para publicar como página.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = new URL('../dist-demo/', import.meta.url).pathname;
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const js = /<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/.exec(html)[1];
const css = /<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/.exec(html)[1];
let style = readFileSync(join(dir, css), 'utf8');
style = style.replace(/url\(\.\/([^)]+)\)/g, (_, f) => {
  const b = readFileSync(join(dir, dirname(css), f));
  const mime = f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.woff') ? 'font/woff' : 'application/octet-stream';
  return `url(data:${mime};base64,${b.toString('base64')})`;
});
const script = readFileSync(join(dir, js), 'utf8')
  .replace(/<\/script/gi, '<\\/script')
  // Não-ASCII escapado: a página funciona mesmo se o servidor não declarar charset.
  .replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const page = `<meta charset="utf-8">
<title>EAP Quantitativos</title>
<style>${style}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(join(dir, 'eap-quantitativos-demo.html'), page);
console.log('ok', (page.length / 1024 / 1024).toFixed(2), 'MB');
