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

test('EAP: gerar pelo template, regenerar mostrando só o que mudou, editar e publicar nova versão de template', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F5');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f5-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  const project = await apiCall(page, 'POST', '/projects', { code: `RES-${uid()}`, name: 'Residencial Aurora', classification: 'VERTICAL' });
  await apiCall(page, 'POST', `/projects/${project.id}/structure/wizard/apply`, SCENARIO_A_VERTICAL);

  await page.goto(`/empreendimentos/${project.id}`);
  await page.getByRole('link', { name: 'EAP', exact: true }).click();
  await expect(page.getByText('EAP ainda não gerada')).toBeVisible();
  await page.getByRole('button', { name: 'Gerar EAP' }).first().click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel('Torres residenciais (Residencial vertical)')).toHaveValue(/.+/);
  await d.getByRole('button', { name: 'Pré-visualizar' }).click();
  const preview = d.getByRole('region', { name: 'Prévia da geração' });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('Removidos', { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f5-previa.png` });
  await d.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const tree = page.getByRole('tree', { name: 'EAP' });
  await expect(tree.getByText('Torre A', { exact: true })).toBeVisible();
  await expect(tree.getByText('Torre B', { exact: true })).toBeVisible();
  await expect(tree.getByText('Áreas comuns', { exact: true })).toBeVisible();

  // Edição manual: renomear "Fundações" da Torre A preserva o título na regeneração
  await page.getByLabel('Buscar na EAP').fill('Fundações');
  await tree.getByRole('treeitem').filter({ hasText: 'Fundações' }).first().getByRole('button').nth(1).click();
  const insp = page.getByRole('complementary', { name: 'Detalhes do nó' });
  await insp.getByLabel('Título').fill('Fundações profundas');
  await insp.getByRole('button', { name: 'Salvar' }).click();
  await expect(insp.getByRole('heading', { name: 'Fundações profundas' })).toBeVisible();
  await expect(insp.getByText(/título editado/)).toBeVisible();
  await page.getByLabel('Buscar na EAP').fill('');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f5-eap.png`, fullPage: true });

  // Acrescenta a Torre C no cadastro físico e regenera: só os nós novos aparecem
  const structure = await apiCall(page, 'GET', `/projects/${project.id}/structure`);
  const vert = structure.modules.find((m: { kind: string }) => m.kind === 'VERTICAL_RESIDENTIAL');
  const tc = await apiCall(page, 'POST', `/projects/${project.id}/structure/nodes`, { moduleId: vert.id, parentId: null, kind: 'TOWER', name: 'Torre C' });
  await apiCall(page, 'POST', `/projects/${project.id}/structure/nodes`, { moduleId: vert.id, parentId: tc.id, kind: 'FLOOR', name: '1º pavimento' });
  await page.reload();
  await page.getByRole('button', { name: 'Regenerar EAP' }).click();
  await d.getByRole('button', { name: 'Pré-visualizar' }).click();
  const novos = preview.locator('details').filter({ hasText: 'Novos' });
  await expect(novos).toContainText('Torre C');
  await expect(novos).not.toContainText('Torre A');
  await expect(preview.getByText('Alterados (', { exact: false })).toHaveCount(0);
  await expect(preview.getByText('Removidos (', { exact: false })).toHaveCount(0);
  await d.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(tree.getByText('Torre C', { exact: true })).toBeVisible();
  await page.getByLabel('Buscar na EAP').fill('profundas');
  await expect(tree.getByText('Fundações profundas', { exact: true })).toBeVisible();

  // Nova versão do template: rascunho, inclusão de nó, publicação
  await page.getByRole('link', { name: 'Templates de EAP' }).click();
  await page.getByRole('navigation', { name: 'Templates' }).getByRole('button', { name: /Residencial vertical/ }).click();
  await page.getByRole('button', { name: 'Nova versão' }).click();
  await expect(page.getByRole('tab', { name: /R2 em elaboração/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Incluir nó na raiz' }).click();
  await d.getByLabel('Título').fill('Serviços preliminares');
  await d.getByLabel('Tipo').selectOption('ITEM');
  await d.getByRole('button', { name: 'Incluir nó' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Serviços preliminares')).toBeVisible();
  // Item sem serviço é permitido? A validação aponta problemas antes de publicar, se houver.
  await page.getByRole('button', { name: 'Publicar R2' }).click();
  await page.getByRole('button', { name: 'Confirmar publicação' }).click();
  await expect(page.getByRole('tab', { name: /R2 publicada/ })).toBeVisible();
  await page.getByRole('button', { name: 'Comparar com R1' }).click();
  await expect(page.getByText('Incluído: Serviços preliminares')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f5-templates.png`, fullPage: true });

  // O empreendimento continua na R1 até regenerar
  await page.goto(`/empreendimentos/${project.id}/eap`);
  await expect(page.getByText('(disponível R2)')).toBeVisible();
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== 'passed') return;
  // Sem rolagem horizontal da página em celular (EAP e templates)
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [page.url(), '/templates']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(0);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f5-mobile.png` });
});
