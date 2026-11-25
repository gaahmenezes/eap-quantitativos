/**
 * Gera a demonstração somente leitura: cria dados de exemplo pela API real, navega pela interface
 * e grava as respostas de leitura (GET e consultas de consolidação) em dist-demo/snapshot.json.
 * Uso: API e web em execução (WEB_URL), depois `npx tsx demo/record.ts`.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { seed } from './seed.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const WEB = process.env['WEB_URL'] ?? 'http://localhost:5176';
const OUT = process.env['OUT'] ?? new URL('../dist-demo/snapshot.json', import.meta.url).pathname;
const READ_POSTS = [/\/consolidation$/, /\/consolidation\/lines$/, /\/workbook-imports\/[^/]+\/preview$/];

const browser = await chromium.launch(process.env['PW_CHROMIUM_PATH'] ? { executablePath: process.env['PW_CHROMIUM_PATH'] } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WEB}/criar-conta`);
await page.getByLabel('Nome da organização').fill('Construtora Horizonte');
await page.getByLabel('Seu nome').fill('Marina Duarte');
await page.getByLabel('E-mail').fill(`demo-${Date.now()}@exemplo.com.br`);
await page.getByLabel('Senha').fill('senha-demonstracao-segura-2026');
await page.getByRole('button', { name: 'Criar organização' }).click();
await page.getByRole('heading', { name: /Olá/ }).waitFor();
console.info('semeando…');
const FIX = new URL('../e2e/fixtures/levantamento-exemplo.xlsx', import.meta.url).pathname;
const ids = await seed(page, existsSync(FIX) ? readFileSync(FIX) : undefined);
console.info('projetos', ids);

// ---- gravação: só leituras; qualquer alteração é bloqueada durante a navegação
const responses: Record<string, { status: number; body: unknown }> = {};
await page.route('**/api/**', (route) => {
  const r = route.request();
  const path = new URL(r.url()).pathname;
  if (r.method() === 'GET' || READ_POSTS.some((re) => re.test(path))) return route.continue();
  return route.abort();
});
page.on('response', async (res) => {
  const req = res.request();
  const url = new URL(req.url());
  if (!url.pathname.startsWith('/api/')) return;
  const method = req.method();
  const path = url.pathname.slice(4) + url.search;
  if (method !== 'GET' && !READ_POSTS.some((re) => re.test(url.pathname))) return;
  try {
    const text = await res.text();
    const key = `${method} ${path}${req.postData() ? ` ${req.postData()}` : ''}`;
    responses[key] = { status: res.status(), body: text ? JSON.parse(text) : null };
  } catch { /* resposta abortada */ }
});

const settle = async () => { await page.waitForLoadState('networkidle').catch(() => undefined); await page.waitForTimeout(150); };
const visit = async (path: string) => { await page.goto(`${WEB}${path}`); await settle(); };
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(100); };
async function each(locator: ReturnType<typeof page.locator>, max: number, fn: (i: number) => Promise<void>) {
  const n = Math.min(await locator.count(), max);
  for (let i = 0; i < n; i++) { await fn(i); }
}
const click = async (l: ReturnType<typeof page.locator>) => { await l.click({ timeout: 3000 }).catch(() => undefined); await settle(); };

// ---- telas globais
for (const p of ['/', '/empreendimentos', '/servicos', '/administracao', '/administracao/catalogo', '/importacoes']) await visit(p);
await visit('/servicos');
for (const tab of ['Categorias', 'Unidades']) await click(page.getByRole('tab', { name: tab }));
await visit('/templates');
await each(page.getByRole('navigation', { name: 'Templates' }).getByRole('button'), 10, async (i) => {
  await click(page.getByRole('navigation', { name: 'Templates' }).getByRole('button').nth(i));
  await each(page.getByRole('tab'), 4, async (k) => click(page.getByRole('tab').nth(k)));
});
await visit('/formulas');
await each(page.getByRole('navigation', { name: 'Fórmulas' }).getByRole('button'), 10, async (i) => click(page.getByRole('navigation', { name: 'Fórmulas' }).getByRole('button').nth(i)));

await visit('/fichas');
await each(page.getByRole('navigation', { name: 'Modelos de ficha' }).getByRole('button'), 12, async (i) => click(page.getByRole('navigation', { name: 'Modelos de ficha' }).getByRole('button').nth(i)));
// busca Ctrl+K e seletor de empreendimento
await page.keyboard.press('Control+k'); await settle(); await esc();

for (const p of [ids.a, ids.b, ids.c]) {
  console.info('projeto', p);
  const base = `/empreendimentos/${p}`;
  // F13: centro operacional e fila de trabalho
  await visit(`${base}/painel`);
  await click(page.getByRole('button', { name: /Empreendimento atual/ })); await esc();
  await page.keyboard.press('Control+k'); await settle(); await esc();
  await click(page.getByRole('button', { name: 'Nova tarefa' })); await esc();
  // F10: fichas (lista e cada ficha, com o painel de destino por linha)
  await visit(`${base}/fichas`);
  const sheetLinks = await page.locator('main table a').evaluateAll((as) => as.map((x) => (x as HTMLAnchorElement).getAttribute('href')));
  for (const h of sheetLinks) { if (!h) continue; await visit(h); await click(page.getByRole('button', { name: 'Destino da linha 1' })); await esc(); await click(page.getByRole('button', { name: 'Escolher âncora' })); }
  // F11: quadros
  await visit(`${base}/quadros`);
  const schedLinks = await page.locator('main table a').evaluateAll((as) => as.map((x) => (x as HTMLAnchorElement).getAttribute('href')));
  for (const h of schedLinks) { if (!h) continue; await visit(h); await click(page.getByRole('button', { name: /^Editar destino/ }).first()); await esc(); }
  // F12: migrações (cada aba e a verificação)
  await visit(`${base}/migracao`);
  const wbLinks = await page.locator('main table a').evaluateAll((as) => as.map((x) => (x as HTMLAnchorElement).getAttribute('href')));
  for (const h of wbLinks) {
    if (!h) continue;
    await visit(h);
    const abas = page.getByRole('navigation', { name: 'Abas da planilha' }).getByRole('button');
    await each(abas, 10, async (i) => { await click(abas.nth(i)); await click(page.getByRole('button', { name: 'Verificar aba' })); });
  }
  await visit(base);
  await each(page.getByRole('tab'), 6, async (i) => click(page.getByRole('tab').nth(i)));
  await visit(`${base}/cadastro`);
  await each(page.getByRole('treeitem'), 30, async (i) => click(page.getByRole('treeitem').nth(i).getByRole('button').last()));
  await click(page.getByRole('tab', { name: /Tipologias/ }));
  await each(page.locator('main button').filter({ hasText: /^(2Q|3Q|A|B|C)\b/ }), 6, async (i) => click(page.locator('main button').filter({ hasText: /^(2Q|3Q|A|B|C)\b/ }).nth(i)));
  await visit(`${base}/infraestrutura`);
  await visit(`${base}/construtivo`);
  await visit(`${base}/eap`);
  await click(page.getByRole('button', { name: 'Expandir tudo' }));
  await each(page.getByRole('treeitem'), 25, async (i) => click(page.getByRole('treeitem').nth(i).getByRole('button').nth(1)));
  // quantitativos: cada item com medição e cada medição
  await visit(`${base}/quantitativos`);
  await click(page.getByLabel('Somente itens com medição'));
  const items = page.getByRole('region', { name: 'Itens da EAP' }).getByRole('button');
  await each(items, 40, async (i) => {
    await click(items.nth(i));
    const rows = page.locator('section[aria-label^="Serviço "] tbody tr td:first-child button');
    await each(rows, 6, async (k) => { await click(rows.nth(k)); await esc(); });
  });
  await visit(`${base}/memorias`);
  for (let k = 0; k < 3; k++) await click(page.getByRole('button', { name: 'Próxima' }));
  await visit(`${base}/revisoes`);
  const revs = page.getByRole('navigation', { name: 'Revisões emitidas' }).getByRole('button');
  await each(revs, 4, async (i) => {
    await click(revs.nth(i));
    const sel = page.getByLabel(/^Comparar R\d+ com$/);
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)).catch(() => [] as string[]);
    for (const v of opts) { await sel.selectOption(v).catch(() => undefined); await settle(); }
  });
  // consolidações: estado atual e cada revisão, cada atalho, detalhamento dos primeiros grupos
  await visit(`${base}/consolidacoes`);
  const bases = await page.getByLabel('Base').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  for (const b of bases) {
    await page.getByLabel('Base').selectOption(b); await settle();
    const presets = page.getByRole('region', { name: 'Configuração' }).getByRole('button').filter({ hasText: /^Por / });
    await each(presets, 8, async (i) => {
      await click(presets.nth(i));
      const drill = page.getByRole('region', { name: 'Resultado' }).locator('tbody tr td:first-child button');
      await each(drill, 3, async (k) => {
        await click(drill.nth(k));
        const lines = page.getByRole('dialog').locator('ul button');
        await each(lines, 2, async (j) => { await click(lines.nth(j)); await click(page.getByRole('button', { name: '← Voltar ao detalhamento' })); });
        await esc();
      });
    });
    const dims = await page.getByLabel('Filtrar por').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    for (const d of dims) { await page.getByLabel('Filtrar por').selectOption(d); await settle(); }
    await page.getByLabel('Filtrar por').selectOption('');
  }
  await visit(`${base}/importacoes`);
}

writeFileSync(OUT, JSON.stringify({ recordedAt: new Date().toISOString(), responses }));
console.info('gravadas', Object.keys(responses).length, 'respostas em', OUT);
await browser.close();
