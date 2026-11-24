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

test('consolidação: tipologia × unidades sem dupla contagem, filtro por quadra e detalhamento até a memória de cálculo', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F7');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f7-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  // Cenário B: 120 casas (60 A / 40 B / 20 C); piso da casa A medido na tipologia, uma casa com medição própria
  const p = (await apiCall(page, 'POST', '/projects', { code: `CAS-${uid()}`, name: 'Residencial Jardins', classification: 'HORIZONTAL' })).id as string;
  await apiCall(page, 'POST', `/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL);
  const typA = (await apiCall(page, 'GET', `/projects/${p}/typologies`)).find((t: { code: string }) => t.code === 'A');
  const types = await apiCall(page, 'GET', '/catalog/element-types');
  const T = (code: string) => types.find((t: { code: string }) => t.code === code).id;
  const r1 = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions`, {});
  const sala = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/elements`, { name: 'Sala', elementTypeId: T('AMBIENTE'), attributes: { area: '18.40' } });
  const piso = await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/elements`, { name: 'Piso da sala', elementTypeId: T('REVESTIMENTO'), attributes: { local: 'Piso' }, parentId: sala.id });
  await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/revisions/${r1.id}/publish`, {});
  const s = await apiCall(page, 'GET', `/projects/${p}/structure`);
  type N = { id: string; kind: string; name: string; parentId: string | null; typologyId: string | null };
  const nodes = s.nodes as N[];
  const unitsA = nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id);
  const q1 = nodes.find((n) => n.kind === 'BLOCK_QUADRA' && n.name === 'Quadra 1')!;
  const inQ1 = (u: N) => { let c: N | undefined = u; while (c) { if (c.id === q1.id) return true; c = nodes.find((x) => x.id === c!.parentId); } return false; };
  const own = unitsA.find(inQ1)!;
  const typAInQ1 = unitsA.filter(inQ1).length;
  await apiCall(page, 'POST', `/projects/${p}/typologies/${typA.id}/propagation`, { unitIds: unitsA.map((u) => u.id) });
  const svc = (await apiCall(page, 'GET', '/catalog/services?q=REV.004')).items[0];
  const item = await apiCall(page, 'POST', `/projects/${p}/wbs/nodes`, { parentId: null, title: 'Pisos', nodeType: 'ITEM' });
  await apiCall(page, 'PUT', `/projects/${p}/wbs/nodes/${item.id}/services`, { serviceIds: [svc.id] });
  const anchor = { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: piso.stableKey };
  await apiCall(page, 'POST', `/projects/${p}/measurements`, { wbsNodeId: item.id, serviceId: svc.id, anchor, calc: { method: 'MANUAL', value: '18.40', unit: 'm²' }, sourceReference: 'ARQ-02 rev. A' });
  await apiCall(page, 'POST', `/projects/${p}/measurements`, { wbsNodeId: item.id, serviceId: svc.id, anchor: { ...anchor, unitId: own.id }, calc: { method: 'MANUAL', value: '20', unit: 'm²' } });

  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Consolidações', exact: true }).click();
  await page.getByRole('button', { name: 'Por tipologia e serviço' }).click();
  const result = page.getByRole('region', { name: 'Resultado' });
  const rowA = result.getByRole('row').filter({ hasText: 'A — Casa tipo A' });
  // 59 × 18,40 + 20 (casa com medição própria substitui, não soma)
  await expect(rowA).toContainText('1.105,6');
  await expect(rowA).toContainText('60'); // linhas efetivas
  await expect(result.getByRole('row').filter({ hasText: 'Total geral' })).toContainText('1.105,6');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-consolidacao.png`, fullPage: true });

  // Filtro: só a Quadra 1 (30 casas A, incluindo a que tem medição própria)
  await page.getByLabel('Filtrar por').selectOption({ label: 'Quadra' });
  await page.getByLabel(/Quadra 1$/).check();
  // casas A da Quadra 1: uma com medição própria (20 m²), as demais com 18,40 m²
  const expected = (Math.round(((typAInQ1 - 1) * 18.4 + 20) * 100) / 100).toLocaleString('pt-BR');
  await expect(rowA).toContainText(expected);
  await expect(page.getByRole('button', { name: 'Remover filtro Quadra' })).toBeVisible();

  // Detalhamento até a memória de cálculo
  await rowA.getByRole('button', { name: 'A — Casa tipo A' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByText(`${typAInQ1} linha(s) efetiva(s)`)).toBeVisible();
  await d.getByRole('button', { name: /20 m²/ }).click();
  await expect(d.getByRole('region', { name: 'Memória de cálculo' })).toContainText('Quantidade informada manualmente');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-detalhe.png` });
  await d.getByRole('button', { name: '← Voltar ao detalhamento' }).click();
  await expect(d.getByText(`${typAInQ1} linha(s) efetiva(s)`)).toBeVisible();
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== 'passed') return;
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'rolagem horizontal em consolidações').toBeLessThanOrEqual(0);
});
