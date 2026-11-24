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

/** Casas tipo A com piso na tipologia e um item "Pisos e muros" com REV.004 e ALV.001. */
async function setup(page: Page, name: string, measure: boolean) {
  const p = (await apiCall(page, 'POST', '/projects', { code: `CAS-${uid()}`, name, classification: 'HORIZONTAL' })).id as string;
  await apiCall(page, 'POST', `/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL);
  const typA = (await apiCall(page, 'GET', `/projects/${p}/typologies`)).find((t: { code: string }) => t.code === 'A');
  const types = await apiCall(page, 'GET', '/catalog/element-types');
  const T = (code: string) => types.find((t: { code: string }) => t.code === code).id;
  const r1 = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions`, {});
  const sala = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/elements`, { name: 'Sala', elementTypeId: T('AMBIENTE'), attributes: {} });
  const piso = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/elements`, { name: 'Piso', elementTypeId: T('REVESTIMENTO'), attributes: { local: 'Piso' }, parentId: sala.id });
  await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/publish`, {});
  const s = await apiCall(page, 'GET', `/projects/${p}/structure`);
  await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/propagation`, { unitIds: s.nodes.filter((n: { kind: string; typologyId: string }) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id).map((n: { id: string }) => n.id) });
  const rev4 = (await apiCall(page, 'GET', '/catalog/services?q=REV.004')).items[0];
  const alv = (await apiCall(page, 'GET', '/catalog/services?q=ALV.001')).items[0];
  const item = await apiCall(page, 'POST', `/projects/${p}/wbs/nodes`, { parentId: null, title: 'Pisos e muros', nodeType: 'ITEM' });
  await apiCall(page, 'PUT', `/projects/${p}/wbs/nodes/${item.id}/services`, { serviceIds: [rev4.id, alv.id] });
  if (measure) await apiCall(page, 'POST', `/projects/${p}/measurements`, { wbsNodeId: item.id, serviceId: rev4.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: piso.stableKey }, calc: { method: 'MANUAL', value: '18.40', unit: 'm²' }, sourceReference: 'ARQ-02' });
  return { p, lot: s.nodes.find((n: { kind: string }) => n.kind === 'LOT') as { code: string; name: string } };
}

test('exportar quantitativos, reimportar em outro empreendimento em etapas, recusar duplicidade e anexar arquivo', async ({ page }, info) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F9');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f9-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  const a = await setup(page, 'Jardins — origem', true);
  const b = await setup(page, 'Jardins — destino', false);

  // exportação pela interface
  await page.goto(`/empreendimentos/${a.p}/quantitativos`);
  await page.getByRole('button', { name: 'Exportar' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Planilha (XLSX)' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^quantitativos-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const file = info.outputPath('quantitativos.xlsx');
  await dl.saveAs(file);

  // importação em etapas no outro empreendimento
  await page.goto(`/empreendimentos/${b.p}`);
  await page.getByRole('link', { name: 'Importações', exact: true }).click();
  await page.getByLabel(/Medições \(quantitativos\)/).check();
  await page.getByLabel('2. Arquivo (XLSX ou CSV, até 20 MB)').setInputFiles(file);
  await page.getByRole('button', { name: 'Enviar e ler arquivo' }).click();
  const wiz = page.getByRole('region', { name: 'Importação' });
  await expect(wiz.getByLabel('Código do item da EAP *')).toHaveValue('0');
  await expect(wiz.getByLabel('Quantidade *')).toHaveValue('5');
  await wiz.getByRole('button', { name: 'Validar' }).click();
  const val = wiz.getByRole('region', { name: 'Validação' });
  await expect(val).toContainText('Válidas 1');
  await expect(val).toContainText('Com erro 0');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f9-importacao.png`, fullPage: true });
  await wiz.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(wiz.getByText(/9\. Relatório: importação aplicada/)).toBeVisible();
  await expect(wiz.getByText('1 registro(s) gravado(s)')).toBeVisible();
  await page.goto(`/empreendimentos/${b.p}/consolidacoes`);
  await expect(page.getByRole('region', { name: 'Resultado' }).getByRole('row').filter({ hasText: 'Total geral' })).toContainText('1.104');

  // o mesmo arquivo de novo: dupla contagem, nada a confirmar
  await page.goto(`/empreendimentos/${b.p}/importacoes`);
  await page.getByLabel(/Medições \(quantitativos\)/).check();
  await page.getByLabel('2. Arquivo (XLSX ou CSV, até 20 MB)').setInputFiles(file);
  await page.getByRole('button', { name: 'Enviar e ler arquivo' }).click();
  await wiz.getByRole('button', { name: 'Validar' }).click();
  await expect(val).toContainText('Com erro 1');
  await expect(val.getByRole('cell', { name: /Dupla contagem/ })).toBeVisible();
  await expect(wiz.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled();
  await wiz.getByRole('button', { name: 'Cancelar importação' }).click();
  await expect(wiz.getByText('Importação cancelada. Nada foi gravado.')).toBeVisible();

  // anexo de arquivo de origem numa medição
  await page.goto(`/empreendimentos/${b.p}/quantitativos`);
  await page.getByRole('button', { name: /Pisos e muros/ }).click();
  const alv = page.getByRole('region', { name: 'Serviço ALV.001' });
  await alv.getByRole('button', { name: 'Nova medição' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Filtrar').fill(a.lot.name);
  await d.getByLabel('Âncora', { exact: true }).selectOption({ label: `${a.lot.code} ${a.lot.name}` });
  await d.getByLabel('Quantidade', { exact: true }).fill('33,3');
  await d.getByLabel('Arquivo de origem (opcional)').setInputFiles({ name: 'levantamento-muro.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% muro\n%%EOF') });
  await d.getByRole('button', { name: 'Gravar medição' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await alv.getByRole('button', { name: new RegExp(a.lot.name) }).click();
  const link = d.getByRole('link', { name: 'levantamento-muro.pdf' });
  await expect(link).toBeVisible();
  const [pdf] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(pdf.suggestedFilename()).toBe('levantamento-muro.pdf');
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== 'passed') return;
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(page.url().replace(/\/[^/]+$/, '/importacoes'));
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'rolagem horizontal em importações').toBeLessThanOrEqual(0);
});
