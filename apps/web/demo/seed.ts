/**
 * Dados de exemplo da demonstração, criados pela API real (mesmas regras e validações da aplicação).
 * Três empreendimentos: vertical (cenário A), horizontal (cenário B) e loteamento com drenagem (cenário C).
 */
import type { Page } from 'playwright';
import { SCENARIO_A_VERTICAL, SCENARIO_B_HORIZONTAL, SCENARIO_C_LOTEAMENTO } from '@eapq/domain';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function call(page: Page, method: string, path: string, body?: unknown, version?: number): Promise<Any> {
  return page.evaluate(async ({ method, path, body, version }) => {
    const csrf = (await (await fetch('/api/auth/me')).json()).csrfToken;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    if (version !== undefined) headers['If-Match'] = String(version);
    const r = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }, { method, path, body, version });
}

const byCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };

async function generateWbs(page: Page, p: string) {
  const s = await call(page, 'GET', `/projects/${p}/structure`);
  const tpls = await call(page, 'GET', '/wbs-templates');
  const selections = s.modules.map((m: Any) => ({ moduleId: m.id, templateVersionId: tpls.find((t: Any) => t.code === byCode[m.kind]).versions[0].id }));
  const plan = await call(page, 'POST', `/projects/${p}/wbs/preview`, { selections });
  await call(page, 'POST', `/projects/${p}/wbs/apply`, { selections, planHash: plan.planHash });
  return call(page, 'GET', `/projects/${p}/wbs`);
}

async function typology(page: Page, p: string, typologyId: string, T: (c: string) => string, rooms: [string, string][]) {
  const base = `/projects/${p}/typologies/${typologyId}`;
  const r = await call(page, 'POST', `${base}/revisions`, {});
  const keys: Record<string, string> = {};
  for (const [room, area] of rooms) {
    const el = await call(page, 'POST', `${base}/revisions/${r.id}/elements`, { name: room, elementTypeId: T('AMBIENTE'), attributes: { area } });
    keys[room] = el.stableKey;
    const piso = await call(page, 'POST', `${base}/revisions/${r.id}/elements`, { name: `Piso — ${room.toLowerCase()}`, elementTypeId: T('REVESTIMENTO'), attributes: { local: 'Piso' }, parentId: el.id });
    keys[`piso:${room}`] = piso.stableKey;
  }
  await call(page, 'POST', `${base}/revisions/${r.id}/publish`, { notes: 'Projeto executivo de arquitetura' });
  return keys;
}

const item = (w: Any, title: string, path: string) => {
  const byId = new Map(w.nodes.map((n: Any) => [n.id, n]));
  const full = (n: Any) => { const t: string[] = []; let c = n; while (c) { t.unshift(c.title); c = byId.get(c.parentId); } return t.join(' › '); };
  const n = w.nodes.find((x: Any) => x.title === title && full(x).includes(path));
  if (!n) throw new Error(`item não encontrado: ${path} › ${title}`);
  return n;
};

export async function seed(page: Page) {
  const types = await call(page, 'GET', '/catalog/element-types');
  const T = (c: string) => types.find((t: Any) => t.code === c).id;
  const services = (await call(page, 'GET', '/catalog/services?limit=200')).items;
  const S = (c: string) => services.find((s: Any) => s.code === c);
  const formulas = await call(page, 'GET', '/formulas');
  const F = (c: string) => formulas.find((f: Any) => f.code === c).versions[0].id;
  const manual = (value: string, unit: string) => ({ method: 'MANUAL', value, unit });

  // ---------- A: Residencial Aurora (vertical)
  const a = (await call(page, 'POST', '/projects', { code: 'AUR-01', name: 'Residencial Aurora', classification: 'VERTICAL', description: 'Duas torres de 10 pavimentos, 4 apartamentos por andar, com áreas comuns e infraestrutura externa.', location: 'Campinas — SP' })).id;
  await call(page, 'POST', `/projects/${a}/structure/wizard/apply`, SCENARIO_A_VERTICAL);
  const typsA = await call(page, 'GET', `/projects/${a}/typologies`);
  for (const t of typsA) {
    await typology(page, a, t.id, T, t.code === '2Q' ? [['Sala', '18.40'], ['Quarto 1', '9.20'], ['Quarto 2', '8.10'], ['Banheiro', '3.60']] : [['Sala', '22.80'], ['Suíte', '12.40'], ['Quarto 1', '9.20'], ['Quarto 2', '8.60'], ['Banheiro', '3.60']]);
    const s = await call(page, 'GET', `/projects/${a}/structure`);
    await call(page, 'POST', `/projects/${a}/typologies/${t.id}/propagation`, { unitIds: s.nodes.filter((n: Any) => n.kind === 'DWELLING_UNIT' && n.typologyId === t.id).map((n: Any) => n.id) });
  }
  const sA = await call(page, 'GET', `/projects/${a}/structure`);
  const wA = await generateWbs(page, a);
  const floors = (tower: string) => sA.nodes.filter((n: Any) => n.kind === 'FLOOR' && sA.nodes.find((x: Any) => x.id === n.parentId)?.name === tower);
  for (const tower of ['Torre A', 'Torre B']) {
    for (const [i, f] of floors(tower).slice(1, 6).entries()) {
      const it = item(wA, 'Estrutura de concreto armado', `${tower} › Estrutura › ${f.name}`);
      await call(page, 'POST', `/projects/${a}/measurements`, { wbsNodeId: it.id, serviceId: S('EST.003').id, anchor: { kind: 'STRUCTURE_NODE', id: f.id }, calc: { method: 'FORMULA', formulaVersionId: F('AREA-RET'), inputs: [{ symbol: 'c', value: '2450', unit: 'cm' }, { symbol: 'l', value: `${18 + i * 0.5}`.replace('.', ','), unit: 'm' }] }, sourceReference: 'EST-04 rev. C' });
      await call(page, 'POST', `/projects/${a}/measurements`, { wbsNodeId: it.id, serviceId: S('EST.001').id, anchor: { kind: 'STRUCTURE_NODE', id: f.id }, calc: { method: 'FORMULA', formulaVersionId: F('VOL-PRISMA'), inputs: [{ symbol: 'c', value: '24.5', unit: 'm' }, { symbol: 'l', value: '18', unit: 'm' }, { symbol: 'h', value: '12', unit: 'cm' }] }, sourceReference: 'EST-04 rev. C' });
      await call(page, 'POST', `/projects/${a}/measurements`, { wbsNodeId: it.id, serviceId: S('EST.002').id, anchor: { kind: 'STRUCTURE_NODE', id: f.id }, calc: manual(`${4.2 + i * 0.1}`, 't'), sourceReference: 'Tabela de armação EST-07' });
    }
    const fund = item(wA, 'Fundação', `${tower} › Fundações`);
    const towerNode = sA.nodes.find((n: Any) => n.kind === 'TOWER' && n.name === tower);
    await call(page, 'POST', `/projects/${a}/measurements`, { wbsNodeId: fund.id, serviceId: S('FUN.001').id, anchor: { kind: 'STRUCTURE_NODE', id: towerNode.id }, calc: manual(tower === 'Torre A' ? '186.4' : '179.95', 'm³'), sourceReference: 'FUN-01 rev. B' });
  }
  const revA0 = await call(page, 'POST', `/projects/${a}/revisions`, { title: 'Projeto legal', notes: 'Base para aprovação na prefeitura.' });
  // revisão de uma medição depois da R00
  const [mEst] = await call(page, 'GET', `/projects/${a}/measurements?serviceId=${S('FUN.001').id}`);
  await call(page, 'POST', `/projects/${a}/measurements/${mEst.id}/revisions`, { calc: manual('192.1', 'm³'), reason: 'Sondagem complementar: estacas mais profundas' }, mEst.version);
  void revA0;

  // ---------- B: Jardins do Lago (horizontal)
  const b = (await call(page, 'POST', '/projects', { code: 'JDL-02', name: 'Jardins do Lago', classification: 'HORIZONTAL', description: '120 casas em 4 quadras: 60 do tipo A, 40 do tipo B e 20 do tipo C.', location: 'Sorocaba — SP' })).id;
  await call(page, 'POST', `/projects/${b}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL);
  const typsB = await call(page, 'GET', `/projects/${b}/typologies`);
  const keysB: Record<string, Record<string, string>> = {};
  const rooms: Record<string, [string, string][]> = { A: [['Sala', '16.20'], ['Quarto 1', '9.00'], ['Quarto 2', '8.40']], B: [['Sala', '19.60'], ['Suíte', '11.80'], ['Quarto 1', '9.00']], C: [['Sala', '24.50'], ['Suíte', '14.20'], ['Quarto 1', '10.40'], ['Quarto 2', '9.60']] };
  for (const t of typsB) {
    keysB[t.code] = await typology(page, b, t.id, T, rooms[t.code]!);
    const s = await call(page, 'GET', `/projects/${b}/structure`);
    await call(page, 'POST', `/projects/${b}/typologies/${t.id}/propagation`, { unitIds: s.nodes.filter((n: Any) => n.kind === 'DWELLING_UNIT' && n.typologyId === t.id).map((n: Any) => n.id) });
  }
  const sB = await call(page, 'GET', `/projects/${b}/structure`);
  const wB = await generateWbs(page, b);
  for (const t of typsB) {
    const grp = wB.nodes.find((n: Any) => n.title.startsWith(`Casas ${t.code} —`));
    const kid = (title: string) => wB.nodes.find((n: Any) => n.parentId === grp.id && n.title === title);
    for (const [room, area] of rooms[t.code]!) {
      await call(page, 'POST', `/projects/${b}/measurements`, { wbsNodeId: kid('Contrapiso, pisos e rodapés').id, serviceId: S('REV.004').id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: t.id, elementKey: keysB[t.code]![`piso:${room}`] }, calc: manual(area, 'm²'), sourceReference: `ARQ-${t.code}-02` });
      await call(page, 'POST', `/projects/${b}/measurements`, { wbsNodeId: kid('Alvenaria e vedações').id, serviceId: S('ALV.001').id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: t.id, elementKey: keysB[t.code]![room] }, calc: { method: 'FORMULA', formulaVersionId: F('AREA-PAREDE'), inputs: [{ symbol: 'perimetro', value: (4 * Math.sqrt(Number(area))).toFixed(2), unit: 'm' }, { symbol: 'pe_direito', value: '2.70', unit: 'm' }, { symbol: 'n_vaos', value: '2', unit: 'un' }, { symbol: 'area_vao', value: '1.68', unit: 'm²' }] }, sourceReference: `ARQ-${t.code}-03` });
    }
    const units = sB.nodes.filter((n: Any) => n.kind === 'DWELLING_UNIT' && n.typologyId === t.id);
    const fund = kid('Fundação');
    await call(page, 'POST', `/projects/${b}/measurements`, { wbsNodeId: fund.id, serviceId: S('FUN.001').id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: t.id, elementKey: keysB[t.code]!['Sala'] }, calc: manual(t.code === 'A' ? '7.8' : t.code === 'B' ? '9.1' : '11.4', 'm³'), sourceReference: 'FUN-CASAS rev. A' });
    if (t.code === 'A') {
      // particularidades: uma casa sem o quarto 2; outra com piso diferente na sala
      await call(page, 'POST', `/projects/${b}/units/${units[3].id}/overrides`, { op: 'EXCLUDE_ELEMENT', targetStableKey: keysB.A!['Quarto 2'], reason: 'Cliente uniu o quarto 2 à sala' });
      await call(page, 'POST', `/projects/${b}/measurements`, { wbsNodeId: kid('Contrapiso, pisos e rodapés').id, serviceId: S('REV.004').id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: t.id, elementKey: keysB.A!['piso:Sala'], unitId: units[3].id }, calc: manual('24.6', 'm²'), sourceReference: 'Personalização casa ' + units[3].name, notes: 'Sala ampliada com a área do quarto 2.' });
    }
  }
  await call(page, 'POST', `/projects/${b}/revisions`, { title: 'Projeto executivo' });

  // ---------- C: Loteamento Vale Verde (infraestrutura)
  const c = (await call(page, 'POST', '/projects', { code: 'VVD-03', name: 'Loteamento Vale Verde', classification: 'LOTEAMENTO', description: 'Fases, quadras e lotes com ruas, redes de drenagem e esgoto.', location: 'Indaiatuba — SP' })).id;
  await call(page, 'POST', `/projects/${c}/structure/wizard/apply`, SCENARIO_C_LOTEAMENTO);
  const sC = await call(page, 'GET', `/projects/${c}/structure`);
  const st = await call(page, 'GET', '/catalog/system-types');
  const ST = (code: string) => st.find((x: Any) => x.code === code).id;
  const sections = sC.nodes.filter((n: Any) => n.kind === 'STREET_SECTION');
  const dren = (await call(page, 'POST', `/projects/${c}/infrastructure/systems`, { systemTypeId: ST('DRENAGEM'), name: 'Drenagem pluvial' })).id;
  const net = (await call(page, 'POST', `/projects/${c}/infrastructure/systems/${dren}/networks`, { code: 'D-01', name: 'Rede da Avenida Principal' })).id;
  const pv: string[] = [];
  const cotas = [['100.000', '98.500'], ['99.600', '98.150'], ['99.100', '97.820'], ['98.700', '97.500'], ['98.300', '97.150']];
  for (const [i, [tampa, fundo]] of cotas.entries()) pv.push((await call(page, 'POST', `/projects/${c}/infrastructure/networks/${net}/nodes`, { elementTypeId: T('PV-DREN'), code: `PV-0${i + 1}`, coverElevation: tampa, bottomElevation: fundo, locationNodeId: sections[i % sections.length].id, attributes: { diametroInterno: '1.20', tipo: 'Concreto pré-moldado' } })).id);
  await generateWbs(page, c);
  const wC = await call(page, 'GET', `/projects/${c}/wbs`);
  const drenItem = (title: string) => wC.nodes.find((n: Any) => n.title === title && n.nodeType === 'ITEM');
  const [esc, tub, pvs] = ['Escavação e reaterro de valas', 'Tubulação de drenagem', 'Poços de visita e bocas de lobo'].map(drenItem);
  const lengths = ['50.000', '62.500', '48.300', '55.700'];
  for (let i = 0; i < 4; i++) {
    const seg = (await call(page, 'POST', `/projects/${c}/infrastructure/networks/${net}/segments`, { elementTypeId: T('TUBO-DREN'), code: `T-0${i + 1}`, fromNodeId: pv[i], toNodeId: pv[i + 1], length: lengths[i], diameter: i < 2 ? '600' : '800', material: 'Concreto', streetSectionId: sections[i % sections.length].id, attributes: { classe: 'PA-2' } })).id;
    await call(page, 'POST', `/projects/${c}/measurements`, { wbsNodeId: tub.id, serviceId: S('DRE.002').id, anchor: { kind: 'NETWORK_SEGMENT', id: seg }, calc: manual(lengths[i]!, 'm'), sourceReference: 'DRN-02 rev. A' });
    await call(page, 'POST', `/projects/${c}/measurements`, { wbsNodeId: esc.id, serviceId: S('DRE.001').id, anchor: { kind: 'NETWORK_SEGMENT', id: seg }, calc: { method: 'FORMULA', formulaVersionId: F('VOL-VALA'), inputs: [{ symbol: 'b', value: i < 2 ? '1.20' : '1.40', unit: 'm' }, { symbol: 'h', value: '1.65', unit: 'm' }, { symbol: 'talude', value: '25', unit: '%' }, { symbol: 'c', value: lengths[i]!, unit: 'm' }] }, sourceReference: 'DRN-02 rev. A' });
  }
  for (const id of pv) await call(page, 'POST', `/projects/${c}/measurements`, { wbsNodeId: pvs.id, serviceId: S('DRE.003').id, anchor: { kind: 'NETWORK_NODE', id }, calc: manual('1', 'un'), sourceReference: 'DRN-02 rev. A' });
  await call(page, 'POST', `/projects/${c}/revisions`, { title: 'Projeto de drenagem' });
  return { a, b, c };
}
