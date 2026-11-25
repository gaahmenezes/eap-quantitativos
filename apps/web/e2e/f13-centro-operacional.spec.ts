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

test('centro operacional: pendência vira tarefa revisada; ficha com destino por linha lançada; painel atualiza a cobertura', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome da organização').fill('Construtora E2E F13');
  await page.getByLabel('Seu nome').fill('Gabriela Lima');
  await page.getByLabel('E-mail').fill(`f13-${uid()}@teste.com.br`);
  await page.getByLabel('Senha').fill('senha-e2e-segura-12345');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  const p = (await apiCall(page, 'POST', '/projects', { code: `OPS-${uid()}`, name: 'Residencial Aurora', classification: 'VERTICAL' })).id as string;
  await apiCall(page, 'POST', `/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL);
  const structure = await apiCall(page, 'GET', `/projects/${p}/structure`);
  const tpls = await apiCall(page, 'GET', '/wbs-templates');
  const codeOf: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
  const selections = structure.modules.map((m: { id: string; kind: string }) => ({ moduleId: m.id, templateVersionId: tpls.find((t: { code: string }) => t.code === codeOf[m.kind]).versions[0].id }));
  const plan = await apiCall(page, 'POST', `/projects/${p}/wbs/preview`, { selections });
  await apiCall(page, 'POST', `/projects/${p}/wbs/apply`, { selections, planHash: plan.planHash });
  type N = { id: string; name: string; code: string; parentId: string | null; title: string };
  const nodes = structure.nodes as N[];
  const torreA = nodes.find((n) => n.name === 'Torre A')!;
  const pav1 = nodes.find((n) => n.name === '1º pavimento' && n.parentId === torreA.id)!;
  const wbs = (await apiCall(page, 'GET', `/projects/${p}/wbs`)).nodes as N[];
  const path = (n: N) => { const t: string[] = []; let c: N | undefined = n; while (c) { t.unshift(c.title); c = wbs.find((x) => x.id === c!.parentId); } return t.join(' › '); };
  const item = wbs.find((n) => n.title === 'Estrutura de concreto armado' && path(n).includes('Torre A › Estrutura › 1º pavimento'))!;
  const conc = (await apiCall(page, 'GET', '/sheet-templates')).find((t: { code: string }) => t.code === 'CONC');
  await apiCall(page, 'POST', `/projects/${p}/sheets`, { templateVersionId: conc.versions[0].id, title: 'Paredes de concreto — Torre A' });

  // Painel: pendência com motivos e cobertura zerada
  await page.goto(`/empreendimentos/${p}`);
  await page.getByRole('link', { name: 'Centro operacional', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Centro operacional' })).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Indicadores' });
  await expect(kpis).toContainText('0%');
  const pend = page.getByRole('region', { name: 'Pendências' });
  await expect(pend).toContainText('Paredes de concreto — Torre A');
  await expect(pend).toContainText('sem item da EAP');

  // Pendência → tarefa com revisão
  await pend.getByRole('button', { name: 'Criar tarefa' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel('Tarefa')).toHaveValue('Concluir e lançar: Paredes de concreto — Torre A');
  await d.getByLabel('Responsável').selectOption({ label: 'Gabriela Lima' });
  await d.getByLabel('Revisor').selectOption({ label: 'Gabriela Lima' });
  await d.getByLabel('Prazo').fill('2030-12-31');
  await d.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const card = page.getByRole('article', { name: 'Tarefa Concluir e lançar: Paredes de concreto — Torre A' });
  await expect(page.getByRole('region', { name: 'Coluna A fazer' }).getByRole('article')).toHaveCount(1);
  await card.getByRole('button', { name: 'Iniciar' }).click();
  await expect(page.getByRole('region', { name: 'Coluna Em andamento' })).toContainText('Concluir e lançar');
  await card.getByRole('button', { name: 'Enviar para revisão' }).click();
  await expect(page.getByRole('region', { name: 'Coluna Em revisão' })).toContainText('Concluir e lançar');
  await card.getByRole('button', { name: 'Devolver' }).click();
  await page.getByRole('dialog').getByLabel('Comentário').fill('Falta o destino por pavimento');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('region', { name: 'Coluna Em andamento' })).toContainText('Concluir e lançar');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f13-painel.png`, fullPage: true });

  // Ficha: item da EAP e destino por linha (sem âncora da ficha)
  await pend.getByRole('link', { name: 'Paredes de concreto — Torre A' }).click();
  await page.getByLabel('Elemento, linha 1').fill('Paredes 1º pavimento');
  await page.getByLabel('Comprimento, linha 1').fill('32,5');
  await page.getByLabel('Altura, linha 1').fill('2,7');
  await page.getByLabel('Desconto por face, linha 1').fill('4,56');
  await page.getByLabel('Espessura, linha 1').fill('10');
  const dest = page.getByRole('region', { name: 'Destino' });
  await dest.getByLabel('Filtrar itens da EAP').fill(item.code);
  await dest.getByLabel('Item da EAP').selectOption({ label: `${item.code} ${item.title}` });
  await page.getByRole('button', { name: 'Destino da linha 1' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Filtrar').fill('1º pavimento');
  await panel.getByLabel('Âncora', { exact: true }).selectOption({ label: `${pav1.code} ${pav1.name}` });
  await panel.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByRole('button', { name: 'Destino da linha 1' })).toContainText('novo destino');
  await page.getByRole('button', { name: 'Salvar e lançar quantitativos' }).click();
  await expect(page.getByText(/Quantitativos lançados: 2 criado/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Destino da linha 1' })).toContainText('1º pavimento');

  // Volta ao painel: cobertura e pendências atualizadas; revisor aprova a tarefa
  await page.getByRole('link', { name: 'Centro operacional', exact: true }).click();
  await expect(pend).not.toContainText('Paredes de concreto — Torre A');
  await expect(page.getByRole('region', { name: 'Cobertura da EAP' })).toContainText('1/');
  await card.getByRole('button', { name: 'Enviar para revisão' }).click();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  const mine = page.getByRole('region', { name: 'Minhas tarefas' });
  await expect(mine).toContainText('aguarda sua revisão');
  await mine.getByRole('link', { name: /Concluir e lançar/ }).click();
  await expect(page.getByRole('heading', { name: 'Paredes de concreto — Torre A' })).toBeVisible();
  await page.getByRole('link', { name: 'Centro operacional', exact: true }).click();
  await card.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('region', { name: 'Coluna Concluída' })).toContainText('Concluir e lançar');
  await expect(page.getByRole('region', { name: 'Atividade recente' })).toContainText('moveu tarefa');
});
