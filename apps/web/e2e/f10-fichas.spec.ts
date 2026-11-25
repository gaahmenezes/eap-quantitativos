import { expect, test, type Page } from '@playwright/test';
import { SCENARIO_A_VERTICAL } from '@eapq/domain';

const SHOTS = process.env['E2E_SHOTS_DIR'];
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function apiCall(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body }) => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    const r = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }, { method, path, body });
}

test('fichas: modelo padrão, grade com cálculo ao vivo, lançamento em quantitativos com memória e relançamento', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F10');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f10-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  const project = await apiCall(page, 'POST', '/projects', { code: `RES-${uid()}`, name: 'Residencial Aurora', classification: 'VERTICAL' });
  const p = project.id as string;
  await apiCall(page, 'POST', `/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL);
  const structure = await apiCall(page, 'GET', `/projects/${p}/structure`);
  const tpls = await apiCall(page, 'GET', '/wbs-templates');
  const codeOf: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
  const selections = structure.modules.map((m: { id: string; kind: string }) => ({ moduleId: m.id, templateVersionId: tpls.find((t: { code: string }) => t.code === codeOf[m.kind]).versions[0].id }));
  const plan = await apiCall(page, 'POST', `/projects/${p}/wbs/preview`, { selections });
  await apiCall(page, 'POST', `/projects/${p}/wbs/apply`, { selections, planHash: plan.planHash });
  type N = { id: string; name: string; code: string; parentId: string | null; title: string };
  const nodes = structure.nodes as N[];
  const torreA = nodes.find((n) => n.name === 'Torre A')!;
  const pav1 = nodes.find((n) => n.name === '1º pavimento' && n.parentId === torreA.id)!;
  const wbs = await apiCall(page, 'GET', `/projects/${p}/wbs`);
  const path = (n: N): string => { const t: string[] = []; let c: N | undefined = n; while (c) { t.unshift(c.title); c = (wbs.nodes as N[]).find((x) => x.id === c!.parentId); } return t.join(' › '); };
  const item = (wbs.nodes as N[]).find((n) => n.title === 'Estrutura de concreto armado' && path(n).includes('Torre A › Estrutura › 1º pavimento'))!;

  // Modelos de ficha da organização
  await page.goto('/fichas');
  await page.getByRole('navigation', { name: 'Modelos de ficha' }).getByRole('button', { name: /Rede enterrada/ }).click();
  await expect(page.getByText('Largura de vala por DN')).toBeVisible();
  await expect(page.getByText('ceil(comp_total / comp_peca)')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f10-modelos.png`, fullPage: true });

  // Nova ficha no empreendimento
  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Fichas de levantamento', exact: true }).click();
  await page.getByRole('button', { name: 'Nova ficha' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Modelo').selectOption({ label: 'CONC R1 — Fôrma e concreto (paredes e lajes)' });
  await d.getByLabel('Título').fill('Paredes de concreto — Torre A, 1º pavimento');
  await d.getByRole('button', { name: 'Criar e abrir' }).click();
  await expect(page.getByRole('heading', { name: 'Paredes de concreto — Torre A, 1º pavimento' })).toBeVisible();

  // Grade: digitação com conta na célula; cálculo ao vivo
  await page.getByLabel('Elemento, linha 1').fill('Paredes externas');
  await page.getByLabel('Comprimento, linha 1').fill('30+2,5');
  await page.getByLabel('Altura, linha 1').fill('2,7');
  await page.getByLabel('Desconto por face, linha 1').fill('4,56');
  await page.getByLabel('Espessura, linha 1').fill('10');
  await page.getByLabel('Espessura, linha 1').press('Enter');
  await expect(page.getByLabel('Espessura, linha 2')).toBeFocused();
  const grid = page.getByRole('region', { name: 'Linhas da ficha' });
  await expect(grid.locator('tfoot')).toContainText('8,319');   // (32,5 × 2,7 − 4,56) × 0,10
  await expect(grid.locator('tfoot')).toContainText('166,38');  // fôrma em 2 faces
  // linha com opção/valor inválido aparece como problema
  await page.getByLabel('Elemento, linha 2').fill('Laje');
  await expect(page.getByText(/Linha 2: Espessura: obrigatório/)).toBeVisible();
  await expect(page.getByRole('button', { name: /lançar quantitativos/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Remover linha 2' }).click();

  // Destino: item da EAP e âncora; serviços sugeridos pelo modelo
  const dest = page.getByRole('region', { name: 'Destino' });
  await dest.getByLabel('Filtrar itens da EAP').fill(item.code);
  await dest.getByLabel('Item da EAP').selectOption({ label: `${item.code} ${item.title}` });
  await dest.getByRole('button', { name: 'Escolher âncora' }).click();
  await dest.getByLabel('Filtrar').fill('1º pavimento');
  await dest.getByLabel('Âncora', { exact: true }).selectOption({ label: `${pav1.code} ${pav1.name}` });
  const outs = page.getByRole('region', { name: 'Saídas' });
  await expect(outs.getByLabel('Serviço de Concreto')).toHaveValue(/.+/);
  await expect(outs.getByLabel('Serviço de Fôrma')).toHaveValue(/.+/);
  await expect(page.getByText('Alterações não salvas')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f10-ficha.png`, fullPage: true });
  await page.getByRole('button', { name: 'Salvar e lançar quantitativos' }).click();
  await expect(page.getByText(/Quantitativos lançados: 2 criado/)).toBeVisible();
  await expect(page.getByText('lançada', { exact: true })).toBeVisible();
  const launched = page.getByRole('region', { name: 'Quantitativos lançados' });
  await expect(launched).toContainText('8,319 m³');
  await expect(launched).toContainText('166,38 m²');

  // Alterar e relançar: nova revisão só no que mudou
  await page.getByLabel('Espessura, linha 1').fill('12');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('alterada — lançar de novo')).toBeVisible();
  await page.getByRole('button', { name: 'Lançar quantitativos' }).click();
  await expect(page.getByText(/0 criado\(s\), 1 revisado\(s\) com nova memória, 1 sem alteração/)).toBeVisible();
  await expect(launched).toContainText('9,9828 m³');

  // Colar um bloco copiado da planilha preenche várias células (milhar pt-BR normalizado)
  await page.getByRole('button', { name: 'Adicionar linha' }).click();
  await page.getByLabel('Elemento, linha 2').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Platibanda\t1.234,5\t1\r\nMureta\t3\t0,5\r\n');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel('Comprimento, linha 2')).toHaveValue('1234,5');
  await expect(page.getByLabel('Altura, linha 2')).toHaveValue('1');
  await expect(page.getByLabel('Elemento, linha 3')).toHaveValue('Mureta');
  await expect(page.getByLabel('Altura, linha 3')).toHaveValue('0,5');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f10-colar.png`, fullPage: true });
  page.once('dialog', (dlg) => dlg.accept());

  // Memória da medição mostra a ficha e as linhas; revisão manual não é oferecida
  await page.getByRole('link', { name: 'Quantitativos', exact: true }).click();
  await page.getByLabel('Buscar item da EAP').fill(item.code);
  await page.getByRole('region', { name: 'Itens da EAP' }).getByRole('button', { name: /Estrutura de concreto armado/ }).click();
  const svc = page.getByRole('region', { name: 'Serviço EST.001' });
  await svc.getByRole('button', { name: new RegExp(pav1.name) }).click();
  const m = page.getByRole('dialog');
  await expect(m.getByText(/Lançada pela ficha/)).toBeVisible();
  await expect(m.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
  const memo = m.getByRole('region', { name: 'Memória de cálculo' });
  await expect(memo.getByText('Paredes externas').first()).toBeVisible();
  await expect(memo.getByText(/Soma da coluna/).first()).toBeVisible();
  await expect(memo).toContainText('9,9828');
  await expect(memo).toContainText('8,319');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f10-memoria.png` });
});
