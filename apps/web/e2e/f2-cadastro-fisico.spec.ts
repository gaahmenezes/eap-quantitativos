import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'senha-e2e-segura-12345';
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function setup(page: Page, classification: 'VERTICAL' | 'HORIZONTAL') {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F2');
  await page.getByLabel('Seu nome').fill('Eng. Responsável');
  await page.getByLabel('E-mail').fill(`f2-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await page.goto('/empreendimentos');
  await page.getByRole('button', { name: /Cadastrar o primeiro empreendimento|Novo empreendimento/ }).first().click();
  await page.getByLabel('Código').fill(`F2-${uid()}`);
  await page.getByLabel('Nome', { exact: true }).fill(classification === 'VERTICAL' ? 'Residencial Torres' : 'Condomínio Jardins');
  await page.getByLabel('Classificação', { exact: true }).selectOption(classification);
  await page.getByRole('button', { name: 'Cadastrar empreendimento' }).click();
  await page.getByRole('link', { name: 'Abrir cadastro físico' }).click();
  await page.getByRole('link', { name: 'Estruturar pelo assistente' }).first().click();
}

test('cenário A pela interface: assistente vertical, prévia, gravação e ajuste de tipologia de uma unidade', async ({ page }) => {
  await setup(page, 'VERTICAL');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Adicionar tipologia de apartamento' }).click();
  await page.getByRole('button', { name: 'Adicionar tipologia de apartamento' }).click();
  await page.getByLabel('Código da tipologia 1').fill('2Q');
  await page.getByLabel('Código da tipologia 2').fill('3Q');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Adicionar torre' }).click();
  for (const [fin, code] of [['01', '2Q'], ['02', '2Q'], ['03', '3Q'], ['04', '3Q']]) {
    for (let t = 0; t < 2; t++) await page.getByLabel(`Final ${fin}`).nth(t).selectOption(code);
  }
  await expect(page.getByText('Total previsto: 80 unidades', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Gerar prévia' }).click();

  // Prévia: nada gravado ainda, contagens exatas
  await expect(page.getByText(/Prévia de/)).toBeVisible();
  const counts = page.getByRole('heading', { name: 'Itens por tipo' }).locator('..');
  await expect(counts.getByRole('row', { name: /Torre 2/ })).toBeVisible();
  await expect(counts.getByRole('row', { name: /Pavimento 22/ })).toBeVisible();
  await expect(counts.getByRole('row', { name: /Unidade habitacional 80/ })).toBeVisible();
  const byTyp = page.getByRole('heading', { name: 'Unidades por tipologia' }).locator('..');
  await expect(byTyp.getByRole('row', { name: /2Q.*40/ })).toBeVisible();
  await expect(byTyp.getByRole('row', { name: /3Q.*40/ })).toBeVisible();

  await page.getByRole('button', { name: 'Gravar estrutura' }).click();
  await expect(page.getByRole('tree')).toBeVisible();
  await expect(page.getByText('Unidade habitacional').first()).toBeVisible();

  // Busca e edição: Apto 101 da Torre A passa de 2Q para 3Q
  await page.getByLabel('Buscar no cadastro').fill('Apto 101');
  await page.getByRole('treeitem', { name: /Apto 101/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Apto 101' })).toBeVisible();
  await page.getByLabel('Tipologia').selectOption({ label: '3Q · Apartamento tipo 2' });
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();

  await page.getByRole('tab', { name: /Tipologias/ }).click();
  await expect(page.getByRole('row', { name: /2Q .* 39 Editar/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /3Q .* 41 Editar/ })).toBeVisible();
});

test('assistente horizontal valida a distribuição de tipologias antes de gravar', async ({ page }) => {
  await setup(page, 'HORIZONTAL');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Adicionar tipologia de casa' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Adicionar tipologia à distribuição' }).click();
  await page.getByLabel('Casas', { exact: true }).fill('15');
  await expect(page.getByText(/Distribuídas: 15 de 20 casas/)).toBeVisible();
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(page.getByText(/Casas — distribuição de tipologias: A soma das quantidades por tipologia \(15\) deve ser igual ao total de casas \(20\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gravar estrutura' })).toHaveCount(0);

  await page.getByLabel('Casas', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await page.getByRole('button', { name: 'Gravar estrutura' }).click();
  await expect(page.getByRole('tree')).toBeVisible();
  await page.getByRole('tab', { name: /Tipologias/ }).click();
  await expect(page.getByRole('row', { name: /C1 .* 20 Editar/ })).toBeVisible();
});
