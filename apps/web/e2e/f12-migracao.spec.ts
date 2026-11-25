import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env['E2E_SHOTS_DIR'];
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const FIXTURE = fileURLToPath(new URL('./fixtures/levantamento-exemplo.xlsx', import.meta.url));

async function apiCall(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body }) => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    const r = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }, { method, path, body });
}

test('migração: planilha com várias abas vira ficha e quadro, com conferência dos totais', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F12');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f12-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  const p = (await apiCall(page, 'POST', '/projects', { code: `MIG-${uid()}`, name: 'Residencial Migrado', classification: 'HORIZONTAL' })).id as string;

  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Migração de planilhas', exact: true }).click();
  await page.getByLabel('Planilha (XLSX)').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Ler planilha' }).click();
  await expect(page.getByRole('heading', { name: 'levantamento-exemplo.xlsx' })).toBeVisible();

  // Aba de cerâmica: destino e mapeamento sugeridos (peça em m), conferência pela coluna "com perda"
  const abas = page.getByRole('navigation', { name: 'Abas da planilha' });
  await expect(abas.getByRole('button', { name: /Considerações Gerais.*Ignorar/ })).toBeVisible();
  await abas.getByRole('button', { name: /Cerâmica MAT/ }).click();
  const aba = page.getByRole('region', { name: 'Aba Cerâmica MAT' });
  await expect(aba.getByLabel('Destino da aba')).toHaveValue('sheet');
  await expect(aba.getByLabel('Linha do cabeçalho')).toHaveValue('4');
  await expect(aba.getByLabel('Unidade de Peça — largura')).toHaveValue('m');
  await expect(aba.getByRole('region', { name: 'Pré-visualização da aba' })).toContainText('Peça — largura');
  await aba.getByLabel('Área com perda (m²)').selectOption({ label: 'Q — Área Total / unid (contando perda)' });
  await aba.getByRole('button', { name: 'Verificar aba' }).click();
  const rep = aba.getByRole('region', { name: 'Verificação da aba' });
  await expect(rep).toContainText('3 linha(s) montada(s) · 1 ignorada(s)');
  await expect(rep).toContainText('Confere — Área com perda');
  await expect(rep).toContainText('planilha 41,50797 · recalculado 41,50797 m²');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f12-migracao.png`, fullPage: true });

  // Coluna errada na conferência aparece como divergência
  await aba.getByLabel('Área com perda (m²)').selectOption({ label: 'O — Área Total p/ execução / unid' });
  await aba.getByRole('button', { name: 'Verificar aba' }).click();
  await expect(rep).toContainText('3 linha(s) divergente(s)');
  await aba.getByLabel('Área com perda (m²)').selectOption({ label: 'Q — Área Total / unid (contando perda)' });

  // Aba hidráulica: quadro, conferência do total × 362
  await abas.getByRole('button', { name: /Hidraulico casa/ }).click();
  const hid = page.getByRole('region', { name: 'Aba Hidraulico casa' });
  await expect(hid.getByLabel('Destino da aba')).toHaveValue('schedule');
  await hid.getByLabel('Título').fill('Hidráulica da casa');
  await hid.getByLabel('Destino 1').fill('Casa tipo');
  await hid.getByLabel('Conferir com a coluna de total da obra').selectOption({ label: 'F — total' });
  await hid.getByLabel('Nº de repetições').fill('362');
  await hid.getByRole('button', { name: 'Verificar aba' }).click();
  await expect(hid.getByRole('region', { name: 'Verificação da aba' })).toContainText('2 linha(s) montada(s)');
  await expect(hid.getByRole('region', { name: 'Verificação da aba' })).toContainText('Confere');

  await page.getByRole('button', { name: 'Aplicar migração' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Criar fichas e quadros' }).click();
  const res = page.getByRole('region', { name: 'Resultado da migração' });
  await expect(res).toContainText('Ficha: Cerâmica MAT');
  await expect(res).toContainText('Quadro: Hidráulica da casa');
  await expect(res.getByText('confere')).toHaveCount(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f12-resultado.png`, fullPage: true });

  // A ficha criada tem as linhas da planilha e o mesmo total
  await res.getByRole('link', { name: 'Ficha: Cerâmica MAT' }).click();
  await expect(page.getByLabel('Ambiente, linha 3')).toHaveValue('Cozinha');
  await expect(page.getByLabel('Peça — largura, linha 1')).toHaveValue('67');
  await expect(page.getByRole('region', { name: 'Linhas da ficha' }).locator('tfoot')).toContainText('41,50797');
  await page.goBack();
  await res.getByRole('link', { name: 'Quadro: Hidráulica da casa' }).click();
  await expect(page.getByLabel('Descrição, item 1')).toHaveValue('Tubo pvc rigido branco');
  await expect(page.getByLabel('Casa tipo, item 2')).toHaveValue('27');
});
