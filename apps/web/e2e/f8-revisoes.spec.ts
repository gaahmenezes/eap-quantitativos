import { expect, test, type Page } from '@playwright/test';
import { SCENARIO_B_HORIZONTAL } from '@eapq/domain';

const SHOTS = process.env['E2E_SHOTS_DIR'];
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function apiCall(page: Page, method: string, path: string, body?: unknown, version?: number) {
  return page.evaluate(async ({ method, path, body, version }) => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    if (version !== undefined) headers['If-Match'] = String(version);
    const r = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }, { method, path, body, version });
}

test('revisões: emitir R00, alterar, comparar com deltas, emitir R01 e consolidar sobre a fotografia', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F8');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f8-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  const p = (await apiCall(page, 'POST', '/projects', { code: `CAS-${uid()}`, name: 'Residencial Jardins', classification: 'HORIZONTAL' })).id as string;
  await apiCall(page, 'POST', `/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL);
  const typA = (await apiCall(page, 'GET', `/projects/${p}/typologies`)).find((t: { code: string }) => t.code === 'A');
  const types = await apiCall(page, 'GET', '/catalog/element-types');
  const r1 = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions`, {});
  const el = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/elements`, { name: 'Piso da sala', elementTypeId: types.find((t: { code: string }) => t.code === 'REVESTIMENTO').id, attributes: { local: 'Piso' } });
  await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/publish`, {});
  const s = await apiCall(page, 'GET', `/projects/${p}/structure`);
  type N = { id: string; kind: string; typologyId: string | null };
  await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/propagation`, { unitIds: (s.nodes as N[]).filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id).map((n) => n.id) });
  const piso = (await apiCall(page, 'GET', '/catalog/services?q=REV.004')).items[0];
  const alv = (await apiCall(page, 'GET', '/catalog/services?q=ALV.001')).items[0];
  const item = await apiCall(page, 'POST', `/projects/${p}/wbs/nodes`, { parentId: null, title: 'Pisos e muros', nodeType: 'ITEM' });
  await apiCall(page, 'PUT', `/projects/${p}/wbs/nodes/${item.id}/services`, { serviceIds: [piso.id, alv.id] });
  const m = await apiCall(page, 'POST', `/projects/${p}/measurements`, { wbsNodeId: item.id, serviceId: piso.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: el.stableKey }, calc: { method: 'MANUAL', value: '18.40', unit: 'm²' } });

  // R00 pela interface
  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Revisões', exact: true }).click();
  await expect(page.getByText('Nenhuma revisão emitida')).toBeVisible();
  await page.getByRole('button', { name: 'Emitir R00' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Título').fill('Projeto legal');
  await d.getByRole('button', { name: 'Emitir R00' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const r00 = page.getByRole('region', { name: 'Revisão R00' });
  await expect(r00).toContainText('1.104 m²');

  // alterações depois da R00
  const cur = await apiCall(page, 'GET', `/projects/${p}/measurements/${m.id}`);
  await apiCall(page, 'POST', `/projects/${p}/measurements/${m.id}/revisions`, { calc: { method: 'MANUAL', value: '19', unit: 'm²' }, reason: 'Revisão de arquitetura' }, cur.version);
  const lot = (s.nodes as N[]).find((n) => n.kind === 'LOT')!;
  await apiCall(page, 'POST', `/projects/${p}/measurements`, { wbsNodeId: item.id, serviceId: alv.id, anchor: { kind: 'STRUCTURE_NODE', id: lot.id }, calc: { method: 'MANUAL', value: '33.3', unit: 'm²' } });
  await page.reload();
  const cmp = r00.getByRole('region', { name: 'Comparação R00 × Estado atual' });
  const q = cmp.getByRole('region', { name: 'Quantitativos' });
  await expect(q.getByRole('row').filter({ hasText: 'REV.004' })).toContainText('+36');
  await expect(q.getByRole('row').filter({ hasText: 'ALV.001' })).toContainText('+33,3');
  await expect(cmp.getByRole('region', { name: 'Medições' })).toContainText('Alterada (R1 → R2)');

  // R01: o painel mostra o que mudou desde a R00
  await page.getByRole('button', { name: 'Emitir R01' }).click();
  await expect(d.getByRole('region', { name: 'Alterações desde a última revisão' })).toContainText('+36');
  await d.getByLabel('Título').fill('Projeto executivo');
  await d.getByRole('button', { name: 'Emitir R01' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('region', { name: 'Revisão R01' })).toContainText('1.173,3 m²');
  await page.getByRole('navigation', { name: 'Revisões emitidas' }).getByRole('button', { name: /R00/ }).click();
  await expect(r00.getByLabel('Comparar R00 com')).toHaveValue(/.+/);
  await expect(r00.getByRole('region', { name: 'Comparação R00 × R01' }).getByRole('region', { name: 'Quantitativos' })).toContainText('+36');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f8-revisoes.png`, fullPage: true });

  // consolidação sobre a fotografia da R00 não muda
  await r00.getByRole('link', { name: 'Consolidar quantitativos da R00' }).click();
  const result = page.getByRole('region', { name: 'Resultado' });
  await expect(result.getByRole('row').filter({ hasText: 'Total geral' })).toContainText('1.104');
  await result.getByRole('button', { name: /REV.004/ }).click();
  await d.getByRole('button', { name: /18,4 m²/ }).first().click();
  await expect(d.getByText('Medição como estava na R00.')).toBeVisible();
  await expect(d.getByRole('region', { name: 'Memória de cálculo' })).toContainText('R1 da medição');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f8-fotografia.png` });
  await page.keyboard.press('Escape');
  await page.getByLabel('Base').selectOption({ label: 'Estado atual' });
  await expect(result.getByRole('row').filter({ hasText: 'Total geral' })).toContainText('1.173,3');
  // estado atual: a medição mostra o histórico de alterações
  await result.getByRole('button', { name: /REV.004/ }).click();
  await d.getByRole('button', { name: /19 m²/ }).first().click();
  await expect(d.getByRole('region', { name: 'Histórico de alterações' })).toContainText('Revisão de arquitetura');
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== 'passed') return;
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [page.url(), page.url().replace(/consolidacoes.*$/, 'revisoes')]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(0);
  }
});
