import { expect, test } from '@playwright/test';

const SHOTS = process.env['E2E_SHOTS_DIR'];
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

test('biblioteca: busca, aviso de duplicidade, serviço específico do empreendimento e conversão de unidades', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F4');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f4-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  const code = `RES-${uid()}`;
  await page.evaluate(async (c) => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ code: c, name: 'Residencial Aurora', classification: 'VERTICAL' }) });
  }, code);

  await page.getByRole('link', { name: 'Biblioteca de serviços' }).click();
  // Busca sem acento encontra o serviço do catálogo inicial
  await page.getByLabel('Buscar serviços').fill('escavacao mecanizada');
  await expect(page.getByRole('cell', { name: 'TER.002' })).toBeVisible();

  // Novo serviço com descrição parecida: aviso, mas o cadastro é permitido
  await page.getByRole('button', { name: 'Novo serviço' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Código').fill('TER.020');
  await d.getByLabel('Unidade').selectOption({ label: 'm³ — metro cúbico' });
  await d.getByLabel('Descrição', { exact: true }).fill('Escavação mecanizada de material de 1ª categoria em vala');
  await expect(d.getByText('Serviços com descrição parecida já cadastrados:')).toBeVisible();
  await expect(d.getByText('TER.002')).toBeVisible();
  await d.getByLabel('Categoria').selectOption({ label: '  Terraplenagem' });
  await d.getByLabel('Critério de medição').fill('Comprimento × largura × profundidade média.');
  await d.getByRole('button', { name: 'Cadastrar serviço' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('Buscar serviços').fill('TER.020');
  await expect(page.getByRole('cell', { name: 'TER.020' })).toBeVisible();

  // Código repetido é bloqueado
  await page.getByRole('button', { name: 'Novo serviço' }).click();
  await d.getByLabel('Código').fill('TER.020');
  await d.getByLabel('Unidade').selectOption({ label: 'm² — metro quadrado' });
  await d.getByLabel('Descrição', { exact: true }).fill('Outro serviço qualquer');
  await d.getByLabel('Categoria').selectOption({ label: 'Infraestrutura' });
  await d.getByRole('button', { name: 'Cadastrar serviço' }).click();
  await expect(d.getByText('O código TER.020 já existe no catálogo da organização.')).toBeVisible();
  await page.keyboard.press('Escape');

  // Serviço específico do empreendimento não aparece no catálogo
  await page.getByLabel('Escopo').selectOption({ label: `${code} · Residencial Aurora` });
  await page.getByRole('button', { name: 'Novo serviço do empreendimento' }).click();
  await d.getByLabel('Código').fill('ESP.001');
  await d.getByLabel('Unidade').selectOption({ label: 'un — unidade' });
  await d.getByLabel('Descrição', { exact: true }).fill('Proteção de árvore existente durante a obra');
  await d.getByLabel('Categoria').selectOption({ label: '  Paisagismo e urbanização' });
  await d.getByRole('button', { name: 'Cadastrar serviço' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('Buscar serviços').fill('ESP.001');
  await expect(page.getByRole('row', { name: /ESP\.001/ })).toContainText('Empreendimento');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f4-servicos.png` });
  await page.getByLabel('Escopo').selectOption({ label: 'Catálogo da organização' });
  await expect(page.getByText('Nenhum serviço encontrado')).toBeVisible();

  // Conversão exata
  await page.getByRole('tab', { name: 'Unidades de medida' }).click();
  await page.getByLabel('Valor').fill('250');
  await page.getByLabel('De', { exact: true }).selectOption({ label: 'cm' });
  await page.getByLabel('Para', { exact: true }).selectOption({ label: 'm' });
  await page.getByRole('button', { name: 'Converter' }).click();
  await expect(page.getByText('2,5 m')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f4-unidades.png` });
});
