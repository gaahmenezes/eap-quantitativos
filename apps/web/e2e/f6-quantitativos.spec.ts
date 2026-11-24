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

test('quantitativos: medição por fórmula com memória, bloqueio de dupla contagem, nova versão de fórmula e recálculo explícito', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F6');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f6-${uid()}@teste.com.br`);
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
  type N = { id: string; name: string; code: string; parentId: string | null };
  const nodes = structure.nodes as N[];
  const torreA = nodes.find((n) => n.name === 'Torre A')!;
  const pav1 = nodes.find((n) => n.name === '1º pavimento' && n.parentId === torreA.id)!;

  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Quantitativos', exact: true }).click();
  await page.getByLabel('Buscar item da EAP').fill('Torre A › Estrutura › 1º pavimento');
  await page.getByRole('region', { name: 'Itens da EAP' }).getByRole('button', { name: /Estrutura de concreto armado/ }).click();
  const forma = page.getByRole('region', { name: 'Serviço EST.003' });
  await forma.getByRole('button', { name: 'Nova medição' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Filtrar').fill('1º pavimento');
  await d.getByLabel('Âncora', { exact: true }).selectOption({ label: `${pav1.code} ${pav1.name}` });
  await d.getByLabel('Por fórmula').check();
  await d.getByLabel('Fórmula', { exact: true }).selectOption({ label: 'AREA-RET R1 — Área retangular' });
  await d.getByLabel('Comprimento (c)').fill('420');
  await d.getByLabel('Unidade de comprimento').selectOption('cm');
  await d.getByLabel('Largura (l)').fill('3,00');
  await d.getByLabel('Documento de origem (opcional)').fill('EST-01 rev. B');
  await d.getByRole('button', { name: 'Calcular prévia' }).click();
  const prev = d.getByRole('region', { name: 'Prévia do cálculo' });
  await expect(prev).toContainText('4,2 m × 3 m');
  await expect(prev).toContainText('12,6 m²');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f6-medicao.png` });
  await d.getByRole('button', { name: 'Gravar medição' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(forma.getByText('Total efetivo 12,6 m²')).toBeVisible();

  // Dupla contagem: medir a torre inteira para o mesmo item e serviço é recusado
  await forma.getByRole('button', { name: 'Nova medição' }).click();
  await d.getByLabel('Filtrar').fill('Torre A');
  await d.getByLabel('Âncora', { exact: true }).selectOption({ label: `${torreA.code} ${torreA.name}` });
  await d.getByLabel('Quantidade', { exact: true }).fill('10');
  await d.getByRole('button', { name: 'Gravar medição' }).click();
  await expect(d.getByText(/já é medido neste item da EAP numa âncora que se sobrepõe/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Nova versão da fórmula: nada muda até recalcular
  await page.getByRole('link', { name: 'Fórmulas' }).click();
  await page.getByRole('navigation', { name: 'Fórmulas' }).getByRole('button', { name: /Área retangular/ }).click();
  await page.getByRole('button', { name: 'Nova versão' }).click();
  await expect(page.getByRole('tab', { name: /R2 em elaboração/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Expressão').fill('c * l * fator');
  await page.getByRole('button', { name: 'Incluir variável' }).click();
  await page.getByLabel('Símbolo da variável 3').fill('fator');
  await page.getByLabel('Descrição da variável 3').fill('Fator de perdas');
  await page.getByLabel('Unidade da variável 3').selectOption('%');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.getByRole('button', { name: 'Publicar R2' }).click();
  await page.getByRole('button', { name: 'Confirmar publicação' }).click();
  await expect(page.getByRole('tab', { name: /R2 publicada/ })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f6-formulas.png`, fullPage: true });

  await page.goto(`/empreendimentos/${p}/quantitativos`);
  await expect(page.getByText(/1 medição\(ões\) usam uma versão antiga de fórmula/)).toBeVisible();
  await page.getByRole('button', { name: /Estrutura de concreto armado/ }).first().click();
  await expect(forma.getByText('Total efetivo 12,6 m²')).toBeVisible();
  await forma.getByRole('button', { name: /1º pavimento/ }).click();
  await d.getByRole('button', { name: 'Recalcular com R2' }).click();
  await d.getByLabel('Fator de perdas (fator)').fill('105');
  await d.getByRole('button', { name: 'Gravar revisão' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(forma.getByText('Total efetivo 13,23 m²')).toBeVisible();
  await forma.getByRole('button', { name: /1º pavimento/ }).click();
  const memory = d.getByRole('region', { name: 'Memória de cálculo' });
  await expect(memory.getByRole('article')).toHaveCount(2);
  await expect(memory).toContainText('Recálculo com a versão mais nova da fórmula');
  await expect(memory).toContainText('AREA-RET R1');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f6-historico.png` });
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Memórias de cálculo' }).click();
  await page.getByLabel('Buscar memórias').fill('EST.003');
  await expect(page.getByText('1–2 de 2')).toBeVisible();
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== 'passed') return;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [page.url(), '/formulas']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(0);
  }
});
