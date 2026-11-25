import { expect, test, type Page } from '@playwright/test';
import { SCENARIO_B_HORIZONTAL } from '@eapq/domain';

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

test('quadros: esquadrias por tipologia com L × A, colar da planilha, resumo × unidades e lançamento com memória', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F11');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f11-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  const p = (await apiCall(page, 'POST', '/projects', { code: `CAS-${uid()}`, name: 'Residencial Jardins', classification: 'HORIZONTAL' })).id as string;
  await apiCall(page, 'POST', `/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL);
  const typA = (await apiCall(page, 'GET', `/projects/${p}/typologies`)).find((t: { code: string }) => t.code === 'A');
  const types = await apiCall(page, 'GET', '/catalog/element-types');
  const tp = `/projects/${p}/typologies/${typA.id}`;
  const r1 = await apiCall(page, 'POST', `${tp}/revisions`, {});
  await apiCall(page, 'POST', `${tp}/revisions/${r1.id}/elements`, { name: 'Casa', elementTypeId: types.find((t: { code: string }) => t.code === 'AMBIENTE').id, attributes: { area: '45' } });
  await apiCall(page, 'POST', `${tp}/revisions/${r1.id}/publish`, {});
  const structure = await apiCall(page, 'GET', `/projects/${p}/structure`);
  await apiCall(page, 'POST', `${tp}/propagation`, { unitIds: structure.nodes.filter((n: { kind: string; typologyId: string }) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id).map((n: { id: string }) => n.id) });
  const tpls = await apiCall(page, 'GET', '/wbs-templates');
  const codeOf: Record<string, string> = { HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA', LAND_SUBDIVISION: 'EAP-LOT' };
  const selections = structure.modules.map((m: { id: string; kind: string }) => ({ moduleId: m.id, templateVersionId: tpls.find((t: { code: string }) => t.code === codeOf[m.kind]).versions[0].id }));
  const plan = await apiCall(page, 'POST', `/projects/${p}/wbs/preview`, { selections });
  await apiCall(page, 'POST', `/projects/${p}/wbs/apply`, { selections, planHash: plan.planHash });
  type N = { id: string; parentId: string | null; title: string; code: string };
  const wbs = (await apiCall(page, 'GET', `/projects/${p}/wbs`)).nodes as N[];
  const path = (n: N) => { const t: string[] = []; let c: N | undefined = n; while (c) { t.unshift(c.title); c = wbs.find((x) => x.id === c!.parentId); } return t.join(' › '); };
  const item = wbs.find((n) => n.title === 'Esquadrias' && path(n).includes('Casas A'))!;

  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Quadros de componentes', exact: true }).click();
  await page.getByRole('button', { name: 'Novo quadro' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Tipo').selectOption({ label: 'Esquadrias' });
  await d.getByRole('button', { name: 'Criar e abrir' }).click();
  await expect(page.getByRole('heading', { name: 'Quadro de esquadrias' })).toBeVisible();

  // Destino: casa tipo A (elemento da tipologia) no item Esquadrias da EAP
  await page.getByRole('button', { name: 'Adicionar destino' }).click();
  await d.getByLabel('Nome do destino').fill('Casa tipo A');
  await d.getByLabel('Filtrar itens da EAP').fill(item.code);
  await d.getByLabel('Item da EAP').selectOption({ label: `${item.code} ${item.title}` });
  await d.getByLabel('Tipo de âncora').selectOption({ label: 'Elemento de tipologia' });
  await d.getByLabel('Tipologia').selectOption({ index: 1 });
  await d.getByLabel('Elemento').selectOption({ label: 'Casa' });
  await d.getByRole('button', { name: 'Aplicar destino' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Item 1 digitado; item 2 colado da planilha (Id, descrição, especificação, unidade, L, A, quantidade)
  await page.getByLabel('Id, item 1').fill('PA1');
  await page.getByLabel('Descrição, item 1').fill('Porta de alumínio');
  await page.getByLabel('Largura, item 1').fill('0,8');
  await page.getByLabel('Altura, item 1').fill('2,3');
  await page.getByLabel('Casa tipo A, item 1').fill('1');
  for (const code of ['ESQ.001', 'ESQ.002']) {
    await page.getByRole('button', { name: 'Escolher serviço do item 1' }).click();
    await page.getByLabel('Buscar serviço').fill(code);
    await page.getByRole('list', { name: 'Resultados de serviços' }).getByRole('button', { name: new RegExp(code.replace('.', '\\.')) }).click();
  }
  await page.getByLabel('Id, item 2').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'J01\tJanela maxim-ar\t2 módulos\tun\t1,6\t1,2\t2\r\n');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel('Descrição, item 2')).toHaveValue('Janela maxim-ar');
  await expect(page.getByLabel('Casa tipo A, item 2')).toHaveValue('2');
  await page.getByRole('button', { name: 'Escolher serviço do item 2' }).click();
  await page.getByLabel('Buscar serviço').fill('ESQ.002');
  await page.getByRole('list', { name: 'Resultados de serviços' }).getByRole('button', { name: /ESQ\.002/ }).click();

  const resumo = page.getByRole('region', { name: 'Quadro de resumo' });
  await expect(resumo).toContainText('5,68'); // 0,8 × 2,3 + 2 × 1,6 × 1,2
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Destinos' })).toContainText('× 60');
  await expect(resumo).toContainText('340,8 m²');
  await expect(resumo).toContainText('60 un');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f11-quadro.png`, fullPage: true });

  await page.getByRole('button', { name: 'Lançar quantitativos' }).click();
  await expect(page.getByText(/Quantitativos lançados: 2 criado/)).toBeVisible();
  await expect(page.getByText('lançado', { exact: true })).toBeVisible();

  // Memória: itens que somaram no serviço; medição não é revisável à mão
  await page.getByRole('link', { name: 'Quantitativos', exact: true }).click();
  await page.getByLabel('Buscar item da EAP').fill(item.code);
  await page.getByRole('region', { name: 'Itens da EAP' }).getByRole('button', { name: /Esquadrias/ }).click();
  const svc = page.getByRole('region', { name: 'Serviço ESQ.002' });
  await expect(svc).toContainText('340,8');
  await svc.getByRole('button', { name: /Casa/ }).click();
  const m = page.getByRole('dialog');
  await expect(m.getByText(/Lançada pelo quadro/)).toBeVisible();
  await expect(m.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
  const memo = m.getByRole('region', { name: 'Memória de cálculo' });
  await expect(memo).toContainText('J01');
  await expect(memo).toContainText('3,84');
  await expect(memo).toContainText('5,68 m²');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f11-memoria.png` });
});
