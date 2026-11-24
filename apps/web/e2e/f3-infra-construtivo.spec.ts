import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'senha-e2e-segura-12345';
const SHOTS = process.env['E2E_SHOTS_DIR'];
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function setup(page: Page) {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F3');
  await page.getByLabel('Seu nome').fill('Ana Ribeiro');
  await page.getByLabel('E-mail').fill(`f3-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  // Cadastro físico via API (já coberto pelos E2E da F2) para focar nesta fase.
  return page.evaluate(async (code) => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    const h = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    const post = async (u: string, body: unknown) => (await fetch(u, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();
    const lot = await post('/api/projects', { code: `LOT-${code}`, name: 'Loteamento Vale Verde', classification: 'LOTEAMENTO' });
    await post(`/api/projects/${lot.id}/structure/wizard/apply`, { typologies: [], modules: [{ kind: 'LAND_SUBDIVISION', name: 'Loteamento', phases: [{ name: 'Fase 1', blocks: [{ name: 'Quadra A', lotCount: 12 }] }], streets: [{ name: 'Avenida Principal', sectionCount: 3 }], areas: [] }] });
    const hor = await post('/api/projects', { code: `CON-${code}`, name: 'Condomínio Jardins', classification: 'HORIZONTAL' });
    await post(`/api/projects/${hor.id}/structure/wizard/apply`, { typologies: [{ code: 'A', name: 'Casa tipo A', kind: 'HOUSE' }], modules: [{ kind: 'HORIZONTAL_RESIDENTIAL', name: 'Casas', layout: 'LOTS', blocks: [{ name: 'Quadra 1', lotCount: 6 }], typologyDistribution: [{ typologyCode: 'A', quantity: 6 }] }] });
    return { lot: lot.id as string, hor: hor.id as string };
  }, uid());
}

test('infraestrutura: rede de drenagem com PVs e trechos, declividade calculada e validação de atributo', async ({ page }) => {
  const ids = await setup(page);
  await page.goto(`/empreendimentos/${ids.lot}/infraestrutura`);
  await page.getByRole('button', { name: 'Cadastrar sistema' }).click();
  await page.getByLabel('Sistema', { exact: true }).selectOption({ label: 'Drenagem' });
  await page.getByLabel('Nome no empreendimento').fill('Drenagem pluvial — Fase 1');
  await page.getByRole('button', { name: 'Cadastrar sistema' }).last().click();
  await page.getByLabel('Código da rede').fill('D-01');
  await page.getByLabel('Nome da rede').fill('Rede da Avenida Principal');
  await page.getByRole('button', { name: 'Incluir rede' }).click();

  for (const [code, cover, bottom] of [['PV-01', '100,000', '98,500'], ['PV-02', '99,600', '98,200'], ['PV-03', '99,100', '97,900']]) {
    await page.getByRole('button', { name: 'Incluir dispositivo' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Tipo de dispositivo').selectOption({ label: 'Poço de visita (drenagem)' });
    await dlg.getByLabel('Código', { exact: true }).fill(code!);
    await dlg.getByLabel('Cota de tampa (m)').fill(cover!);
    await dlg.getByLabel('Cota de fundo (m)').fill(bottom!);
    await dlg.getByLabel('Diâmetro interno (m)').fill('1,20');
    await dlg.getByRole('button', { name: 'Incluir dispositivo' }).click();
    await expect(page.getByRole('cell', { name: code, exact: true })).toBeVisible();
  }

  // Boca de lobo sem o atributo obrigatório "Tipo": erro no campo, nada gravado
  await page.getByRole('button', { name: 'Incluir dispositivo' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Tipo de dispositivo').selectOption({ label: 'Boca de lobo' });
  await dlg.getByLabel('Código', { exact: true }).fill('BL-01');
  await dlg.getByRole('button', { name: 'Incluir dispositivo' }).click();
  await expect(dlg.getByText('Tipo é obrigatório.')).toBeVisible();
  await dlg.getByLabel('Tipo *', { exact: true }).selectOption('Dupla');
  await dlg.getByRole('button', { name: 'Incluir dispositivo' }).click();
  await expect(page.getByRole('cell', { name: 'BL-01', exact: true })).toBeVisible();

  for (const [from, to, length] of [['PV-01', 'PV-02', '50'], ['PV-02', 'PV-03', '60']]) {
    await page.getByRole('button', { name: 'Incluir trecho' }).first().click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Montante (de)').selectOption({ label: from! });
    await d.getByLabel('Jusante (para)').selectOption({ label: to! });
    await d.getByLabel('Comprimento (m) *').fill(length!);
    await d.getByLabel('Diâmetro nominal (mm)').fill('600');
    await d.getByLabel('Classe').selectOption('PA-2');
    await d.getByRole('button', { name: 'Incluir trecho' }).click();
    await expect(page.getByRole('cell', { name: `${from} → ${to}` })).toBeVisible();
  }
  // i = (98,500 − 98,200) / 50 = 0,6 % ; prof. média = (1,50 + 1,40) / 2 = 1,45 m
  const t1 = page.getByRole('row', { name: /PV-01 → PV-02/ });
  await expect(t1).toContainText('0,600');
  await expect(t1).toContainText('1,45');
  await expect(page.getByRole('row', { name: /PV-02 → PV-03/ })).toContainText('0,500');
  await expect(page.getByText(/2 trechos · 110,00 m/)).toBeVisible();
  await shot(page, 'f3-infraestrutura');
});

test('construtivo: revisão publicada, propagação controlada e particularidade da unidade', async ({ page }) => {
  const ids = await setup(page);
  await page.goto(`/empreendimentos/${ids.hor}/construtivo`);
  await page.getByRole('button', { name: 'Criar a primeira revisão' }).click();
  for (const [name, area] of [['Sala', '18,40'], ['Quarto 1', '9']]) {
    await page.getByRole('button', { name: 'Incluir elemento' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Tipo de elemento').selectOption({ label: 'Ambiente / cômodo' });
    await d.getByLabel('Nome', { exact: true }).fill(name!);
    await d.getByLabel('Área (m²)').fill(area!);
    await d.getByRole('button', { name: 'Incluir elemento' }).click();
    await expect(page.getByText(name!, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('Área: 18,4 m²')).toBeVisible();
  await page.getByRole('button', { name: 'Publicar R1' }).click();
  await page.getByRole('button', { name: 'Confirmar publicação' }).click();
  await expect(page.getByText(/Publicada em/)).toBeVisible();
  // Publicar não altera unidades: 6 pendentes até a atualização explícita
  await expect(page.getByText(/0 atualizadas, 6 pendentes/)).toBeVisible();
  await page.getByRole('button', { name: /Selecionar as 6 pendentes/ }).click();
  await page.getByRole('button', { name: /Atualizar 6 para R1/ }).click();
  await expect(page.getByText('6 unidade(s) atualizadas para a R1.')).toBeVisible();

  await page.getByRole('button', { name: 'Casa Quadra 1 L01' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Excluir elemento da tipologia' }).click();
  await d.getByLabel('Elemento a excluir nesta unidade').selectOption({ label: 'Quarto 1' });
  await d.getByLabel('Motivo').fill('Cliente uniu o quarto à sala');
  await d.getByRole('button', { name: 'Registrar particularidade' }).click();
  await expect(d.getByText('Excluídos nesta unidade: Quarto 1')).toBeVisible();
  await expect(d.getByText('Motivo: Cliente uniu o quarto à sala', { exact: false })).toBeVisible();
  await shot(page, 'f3-unidade');
  await page.keyboard.press('Escape');

  // Nova revisão sem o Quarto 1: a unidade personalizada aparece com conflito, sem perder a particularidade
  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Quarto 1' }).getByRole('button', { name: 'Remover' }).click();
  await page.getByRole('button', { name: 'Publicar R2' }).click();
  await page.getByRole('button', { name: 'Confirmar publicação' }).click();
  await expect(page.getByRole('row', { name: /Casa Quadra 1 L01/ })).toContainText('Pendente, com conflito');
  await page.getByRole('button', { name: /Selecionar as 6 pendentes/ }).click();
  const update = page.getByRole('button', { name: /Atualizar 6 para R2/ });
  await expect(update).toBeDisabled();
  await page.getByLabel(/com particularidades em conflito/).check();
  await update.click();
  await expect(page.getByText('6 unidade(s) atualizadas para a R2.')).toBeVisible();
  await page.getByRole('button', { name: 'Casa Quadra 1 L01' }).click();
  await expect(page.getByRole('dialog').getByText('O elemento excluído não existe na revisão fixada.')).toBeVisible();
  await shot(page, 'f3-construtivo');
});
