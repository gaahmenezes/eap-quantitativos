import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'senha-e2e-segura-12345';
const uid = () => Math.random().toString(36).slice(2, 8);

async function signup(page: Page, org: string) {
  const email = `e2e-${uid()}@teste.com.br`;
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill(org);
  await page.getByLabel('Seu nome').fill('Eng. Responsável');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  return email;
}

test('ciclo de vida do empreendimento: criar, editar, conflito de versão, arquivar e histórico', async ({ page, browser }) => {
  await signup(page, 'Construtora E2E');
  const code = `E2E-${uid().toUpperCase()}`;

  await page.getByRole('link', { name: 'Empreendimentos', exact: true }).click();
  await page.getByRole('button', { name: /Cadastrar o primeiro empreendimento|Novo empreendimento/ }).first().click();
  // validação no cliente
  await page.getByRole('button', { name: 'Cadastrar empreendimento' }).click();
  await expect(page.getByText('Campo obrigatório').first()).toBeVisible();

  await page.getByLabel('Código').fill(code);
  await page.getByLabel('Nome', { exact: true }).fill('Loteamento Vale Verde');
  await page.getByLabel('Classificação', { exact: true }).selectOption('LOTEAMENTO');
  await page.getByRole('button', { name: 'Cadastrar empreendimento' }).click();
  await expect(page.getByRole('heading', { name: 'Loteamento Vale Verde' })).toBeVisible();
  await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
  const url = page.url();

  // Outra aba altera o registro antes: a edição da primeira aba deve ser rejeitada (409).
  const other = await page.context().newPage();
  await other.goto(url);
  await other.getByRole('button', { name: 'Editar dados' }).click();
  await other.getByLabel('Localização').fill('Sorocaba, SP');
  await other.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(other.getByText('Alterações salvas.')).toBeVisible();

  await page.getByRole('button', { name: 'Editar dados' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Nome desatualizado');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText(/foi alterado por outra pessoa/)).toBeVisible();
  await page.getByRole('button', { name: 'Fechar painel' }).click();
  await expect(page.getByText('Sorocaba, SP')).toBeVisible();

  // Arquivar exige motivo
  await page.getByRole('button', { name: 'Arquivar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arquivar' }).click();
  await expect(page.getByText('Informe o motivo do arquivamento.')).toBeVisible();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Projeto suspenso pelo cliente');
  await page.getByRole('dialog').getByRole('button', { name: 'Arquivar' }).click();
  await expect(page.getByText(/Empreendimento arquivado em/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar dados' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByText('Motivo: Projeto suspenso pelo cliente')).toBeVisible();
  await expect(page.getByText('Arquivamento', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('cell', { name: 'Sorocaba, SP' })).toBeVisible();

  // Outra organização não enxerga o empreendimento
  const ctx = await browser.newContext();
  const outsider = await ctx.newPage();
  await signup(outsider, 'Concorrente');
  await outsider.goto(new URL(url).pathname);
  await expect(outsider.getByText('Empreendimento não encontrado')).toBeVisible();
  await ctx.close();
});

test('convite: membro sem vínculo não acessa; após vínculo como leitor, apenas consulta', async ({ page, browser }) => {
  await signup(page, 'Construtora Convites');
  await page.getByRole('link', { name: 'Empreendimentos', exact: true }).click();
  await page.getByRole('button', { name: /Cadastrar o primeiro empreendimento|Novo empreendimento/ }).first().click();
  await page.getByLabel('Código').fill(`CNV-${uid().toUpperCase()}`);
  await page.getByLabel('Nome', { exact: true }).fill('Residencial Aurora');
  await page.getByRole('button', { name: 'Cadastrar empreendimento' }).click();
  await expect(page.getByRole('heading', { name: 'Residencial Aurora' })).toBeVisible();
  const projectPath = new URL(page.url()).pathname;

  await page.getByRole('link', { name: 'Administração' }).click();
  const email = `membro-${uid()}@teste.com.br`;
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Gerar convite' }).click();
  const link = await page.getByLabel('Link do convite').inputValue();

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  await member.goto(new URL(link).pathname + new URL(link).search);
  await member.getByLabel('Seu nome').fill('Técnica de Campo');
  await member.getByLabel('Senha').fill(PASSWORD);
  await member.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(member.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await member.goto(projectPath);
  await expect(member.getByText('Empreendimento não encontrado')).toBeVisible();

  await page.goto(`${projectPath}?aba=membros`);
  await page.getByLabel('Vincular membro').selectOption({ label: `Técnica de Campo — ${email}` });
  await page.getByLabel('Papel', { exact: true }).selectOption('VIEWER');
  await page.getByRole('button', { name: 'Vincular' }).click();
  await expect(page.getByRole('cell', { name: email })).toBeVisible();

  await member.goto(projectPath);
  await expect(member.getByRole('heading', { name: 'Residencial Aurora' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Editar dados' })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);
  await expect(member.getByRole('tab', { name: 'Histórico' })).toHaveCount(0);
  await ctx.close();
});
