import { describe, expect, it } from 'vitest';
import { planStructure, type StructurePlanInput } from '../structure/planner.js';
import { SCENARIO_A_VERTICAL, SCENARIO_B_HORIZONTAL, SCENARIO_C_LOTEAMENTO, SCENARIO_D_MISTO } from '../structure/scenarios.js';
import { DEFAULT_WBS_TEMPLATES } from './defaults.js';
import { diffWbs, type ExistingWbsNode } from './diff.js';
import { generateWbs, stableHash, validateTemplate, WbsGenerationError } from './generate.js';
import type { DesiredNode, ProjectFacts, TemplateDef } from './model.js';

/** Fatos a partir de um plano do assistente (chaves do plano viram ids). */
function factsFrom(input: StructurePlanInput, classification = 'VERTICAL', systems: ProjectFacts['systems'] = []): ProjectFacts {
  const plan = planStructure(input);
  return {
    classification,
    modules: plan.modules.map((m) => ({ id: m.key, kind: m.kind, name: m.name, code: String(m.position).padStart(2, '0'), position: m.position })),
    structure: plan.modules.flatMap((m) => m.nodes.map((n) => ({ id: n.key, moduleId: m.key, parentId: n.parentKey, kind: n.kind, name: n.name, code: n.key, position: n.position, typologyId: n.typologyCode ?? null }))),
    typologies: input.typologies.map((t) => ({ id: t.code, code: t.code, name: t.name, kind: t.kind })),
    systems,
  };
}

const tpl = (code: string, version = 'v1'): TemplateDef => {
  const t = DEFAULT_WBS_TEMPLATES.find((x) => x.code === code)!;
  return { templateId: code, versionId: version, moduleKinds: t.moduleKinds, nodes: t.nodes.map((n, i) => ({ key: n.key, parentKey: n.parent, title: n.title, nodeType: n.type, condition: n.condition ?? null, repeat: n.repeat ?? null, position: i + 1, serviceIds: n.services ?? [] })) };
};
const byKind: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
const all = (f: ProjectFacts) => f.modules.map((m) => ({ moduleId: m.id, template: tpl(byKind[m.kind]!) }));
const titles = (nodes: DesiredNode[], parentTitle: string) => {
  const p = nodes.find((n) => n.title === parentTitle)!;
  return nodes.filter((n) => n.parentKey === p.key).map((n) => n.title);
};

describe('templates padrão', () => {
  it('todos são válidos', () => {
    for (const t of DEFAULT_WBS_TEMPLATES) expect(validateTemplate(tpl(t.code)), t.code).toEqual([]);
  });
  it('validação aponta variável indisponível, item com subnós, condição inválida e chaves desbalanceadas', () => {
    const issues = validateTemplate({
      moduleKinds: ['VERTICAL_RESIDENTIAL'],
      nodes: [
        { key: 'a', parentKey: null, title: '{torre.nome}', nodeType: 'GROUP', condition: null, repeat: null, position: 1, serviceIds: [] },
        { key: 'b', parentKey: null, title: 'Item', nodeType: 'ITEM', condition: 'qtd.torres >', repeat: null, position: 2, serviceIds: [] },
        { key: 'c', parentKey: 'b', title: 'Filho {modulo.nome', nodeType: 'GROUP', condition: 'modulo.nome > 1', repeat: null, position: 1, serviceIds: [] },
      ],
    });
    const msgs = issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/\{torre.nome\} não está disponível/);
    expect(msgs).toMatch(/item quantificável e não pode ter subnós/);
    expect(msgs).toMatch(/Condição inválida: Expressão incompleta/);
    expect(msgs).toMatch(/desbalanceadas/);
    expect(msgs).toMatch(/exige números/);
  });
});

describe('geração — cenário A (vertical)', () => {
  const facts = factsFrom(SCENARIO_A_VERTICAL);
  const nodes = generateWbs(facts, all(facts));
  it('organiza por torre, pavimento e tipologia', () => {
    expect(titles(nodes, 'Torres residenciais')).toEqual(['Torre A', 'Torre B']);
    const torreA = nodes.find((n) => n.title === 'Torre A')!;
    expect(nodes.filter((n) => n.parentKey === torreA.key).map((n) => n.title)).toEqual(['Fundações', 'Estrutura', 'Vedações, acabamentos e instalações', 'Cobertura']);
    const estr = nodes.find((n) => n.parentKey === torreA.key && n.title === 'Estrutura')!;
    expect(nodes.filter((n) => n.parentKey === estr.key)).toHaveLength(11); // térreo + 10
    const acab = nodes.find((n) => n.parentKey === torreA.key && n.title.startsWith('Vedações'))!;
    const floors = nodes.filter((n) => n.parentKey === acab.key);
    expect(floors).toHaveLength(10); // térreo sem unidades fica de fora (condição)
    expect(nodes.filter((n) => n.parentKey === floors[0]!.key).map((n) => n.title)).toEqual([
      'Apartamentos 2Q — Apartamento 2 quartos (2 un.)',
      'Apartamentos 3Q — Apartamento 3 quartos (2 un.)',
    ]);
  });
  it('itens quantificáveis trazem os serviços sugeridos e o vínculo com o cadastro', () => {
    const item = nodes.find((n) => n.title === 'Estrutura de concreto armado')!;
    expect(item).toMatchObject({ nodeType: 'ITEM', serviceIds: ['EST.001', 'EST.002', 'EST.003'] });
    const floor = nodes.find((n) => n.key === item.parentKey)!;
    expect(floor.binding).toMatchObject({ kind: 'STRUCTURE' });
    expect(nodes.find((n) => n.title.startsWith('Apartamentos 2Q'))!.binding).toEqual({ kind: 'TYPOLOGY', id: '2Q' });
  });
  it('é determinística, inclusive com os fatos em outra ordem', () => {
    const shuffled = { ...facts, structure: [...facts.structure].reverse(), modules: [...facts.modules].reverse() };
    expect(stableHash(generateWbs(shuffled, all(facts)))).toBe(stableHash(nodes));
    expect(new Set(nodes.map((n) => n.key)).size).toBe(nodes.length);
  });
  it('raízes de módulos diferentes têm posições sequenciais (ordem estável entre gerações)', () => {
    expect(nodes.filter((n) => n.parentKey === null).map((n) => [n.title, n.position])).toEqual([['Torres residenciais', 1], ['Áreas comuns', 2], ['Infraestrutura externa', 3]]);
  });
  it('áreas comuns e infraestrutura entram como módulos próprios', () => {
    expect(titles(nodes, 'Áreas comuns')).toEqual(['Portaria', 'Salão de festas', 'Piscina', 'Reservatório inferior']);
    expect(titles(nodes, 'Infraestrutura externa')).toEqual(['Vias e acessos']);
  });
});

describe('geração — cenário B (horizontal)', () => {
  it('agrupa as 120 casas por tipologia com a quantidade de unidades', () => {
    const facts = factsFrom(SCENARIO_B_HORIZONTAL, 'HORIZONTAL');
    const nodes = generateWbs(facts, all(facts));
    expect(titles(nodes, 'Casas')).toEqual(['Casas A — Casa tipo A (60 un.)', 'Casas B — Casa tipo B (40 un.)', 'Casas C — Casa tipo C (20 un.)']);
  });
});

describe('geração — cenário C (loteamento com infraestrutura)', () => {
  const systems: ProjectFacts['systems'] = [
    { id: 's-dre', typeCode: 'DRENAGEM', typeName: 'Drenagem', name: 'Drenagem pluvial', networks: [{ id: 'n1', code: 'D-01', name: 'Av. Principal' }, { id: 'n2', code: 'D-02', name: 'Rua das Palmeiras' }] },
    { id: 's-pav', typeCode: 'PAVIMENTACAO', typeName: 'Pavimentação', name: 'Pavimentação', networks: [] },
  ];
  const facts = factsFrom(SCENARIO_C_LOTEAMENTO, 'LOTEAMENTO', systems);
  const nodes = generateWbs(facts, all(facts));
  it('fases, quadras, ruas por trecho e áreas', () => {
    expect(titles(nodes, 'Fase 1')).toEqual(['Quadra A (20 lotes)', 'Quadra B (18 lotes)']);
    expect(titles(nodes, 'Sistema viário')).toEqual(['Avenida Principal', 'Rua das Palmeiras', 'Rua dos Ipês']);
    expect(titles(nodes, 'Avenida Principal')).toHaveLength(6);
    expect(titles(nodes, 'Áreas verdes e institucionais')).toEqual(['Área institucional 1', 'Área verde 1', 'Área verde 2']);
  });
  it('infraestrutura por sistema e rede, com itens do tipo de sistema', () => {
    expect(titles(nodes, 'Infraestrutura')).toEqual(['Drenagem pluvial', 'Pavimentação']);
    expect(titles(nodes, 'Drenagem pluvial')).toEqual(['Rede D-01 — Av. Principal', 'Rede D-02 — Rua das Palmeiras']);
    expect(titles(nodes, 'Rede D-01 — Av. Principal')).toEqual(['Escavação e reaterro de valas', 'Tubulação de drenagem', 'Poços de visita e bocas de lobo']);
    const pavSystem = nodes.find((n) => n.binding.kind === 'SYSTEM' && n.binding.id === 's-pav')!;
    expect(nodes.filter((n) => n.parentKey === pavSystem.key).map((n) => n.title)).toEqual(['Base, sub-base e revestimento']);
  });
});

describe('geração — cenário D (misto)', () => {
  it('cada módulo recebe o template do seu tipo, sem hierarquia imposta entre eles', () => {
    const facts = factsFrom(SCENARIO_D_MISTO, 'MISTO');
    const nodes = generateWbs(facts, all(facts));
    expect(nodes.filter((n) => n.parentKey === null).map((n) => n.title)).toEqual(['Setor vertical', 'Setor de casas', 'Lotes comerciais', 'Áreas comuns']);
    expect(titles(nodes, 'Setor de casas')).toEqual(['Casas CS1 — Casa térrea (40 un.)']);
  });
  it('rejeita template incompatível com o tipo do módulo', () => {
    const facts = factsFrom(SCENARIO_D_MISTO, 'MISTO');
    expect(() => generateWbs(facts, [{ moduleId: facts.modules[0]!.id, template: tpl('EAP-LOT') }])).toThrow(WbsGenerationError);
  });
});

// ---------------------------------------------------------------- diff

const asExisting = (nodes: DesiredNode[], patch: (e: ExistingWbsNode) => Partial<ExistingWbsNode> = () => ({})): ExistingWbsNode[] => {
  const idOf = new Map(nodes.map((n) => [n.key, `id-${n.key}`]));
  return nodes.map((n) => {
    const e: ExistingWbsNode = {
      id: idOf.get(n.key)!, parentId: n.parentKey ? idOf.get(n.parentKey)! : null, generationKey: n.key, moduleId: n.moduleId, title: n.title, nodeType: n.nodeType,
      position: n.position, status: 'ACTIVE', archived: false, origin: 'GENERATED', titleOverridden: false, placementOverridden: false, templateVersionId: n.templateVersionId,
    };
    return { ...e, ...patch(e) };
  });
};

describe('regeneração controlada (diff)', () => {
  const base = factsFrom(SCENARIO_A_VERTICAL);
  const modules = base.modules.map((m) => m.id);
  const gen = (f: ProjectFacts) => generateWbs(f, all(f));
  const v1 = gen(base);
  const none = new Set<string>();

  it('primeira geração cria tudo; repetir não muda nada', () => {
    expect(diffWbs([], v1, { moduleIds: modules, protectedIds: none }).create).toHaveLength(v1.length);
    const d = diffWbs(asExisting(v1), v1, { moduleIds: modules, protectedIds: none });
    expect(d).toMatchObject({ create: [], update: [], remove: [], obsolete: [], unchanged: v1.length });
  });

  it('incluir uma torre cria apenas a subárvore nova', () => {
    const input = structuredClone(SCENARIO_A_VERTICAL);
    (input.modules[0] as { towers: unknown[] }).towers.push({ name: 'Torre C', floors: 2, unitsPerFloor: 2, unitTypologies: ['2Q', '3Q'] });
    const v2 = gen(factsFrom(input));
    const d = diffWbs(asExisting(v1), v2, { moduleIds: modules, protectedIds: none });
    expect(d.update).toEqual([]);
    expect(d.remove).toEqual([]);
    expect(d.create[0]!.title).toBe('Torre C');
    expect(d.create.every((n) => n.key.includes('torre=m1/t3'))).toBe(true);
  });

  it('remover uma torre apaga só nós sem dados; nós com dados ficam obsoletos junto com seus ancestrais', () => {
    const input = structuredClone(SCENARIO_A_VERTICAL);
    (input.modules[0] as { towers: unknown[] }).towers.pop();
    const v2 = gen(factsFrom(input));
    const existing = asExisting(v1);
    const item = existing.find((e) => e.title === 'Estrutura de concreto armado' && e.generationKey!.includes('torre=m1/t2'))!;
    const d = diffWbs(existing, v2, { moduleIds: modules, protectedIds: new Set([item.id]) });
    const obsoleteTitles = d.obsolete.map((o) => o.title);
    expect(obsoleteTitles).toEqual(expect.arrayContaining(['Torre B', 'Estrutura', 'Estrutura de concreto armado']));
    expect(d.obsolete.find((o) => o.id === item.id)!.reason).toBe('possui dados vinculados');
    expect(d.remove.length).toBeGreaterThan(0);
    expect(d.remove.some((r) => r.id === item.id)).toBe(false);
  });

  it('nós manuais nunca são tocados e protegem o nó gerado onde estão', () => {
    const existing = asExisting(v1);
    const torreB = existing.find((e) => e.title === 'Torre B')!;
    existing.push({ ...torreB, id: 'manual-1', parentId: torreB.id, generationKey: null, origin: 'MANUAL', title: 'Elevadores (manual)' });
    const input = structuredClone(SCENARIO_A_VERTICAL);
    (input.modules[0] as { towers: unknown[] }).towers.pop(); // remove Torre B
    const d = diffWbs(existing, gen(factsFrom(input)), { moduleIds: modules, protectedIds: none });
    expect(d.obsolete).toEqual([{ id: torreB.id, title: 'Torre B', reason: 'possui subnós que permanecem' }]);
    expect([...d.remove, ...d.obsolete].some((r) => r.id === 'manual-1')).toBe(false);
  });

  it('respeita título editado, posição movida pelo usuário e exclusões feitas pelo usuário', () => {
    const existing = asExisting(v1, (e) => (e.title === 'Cobertura' ? { titleOverridden: true, title: 'Cobertura metálica' } : e.title === 'Fundações' ? { placementOverridden: true, position: 9 } : {}));
    const archived = existing.find((e) => e.title === 'Torre B')!;
    archived.archived = true;
    const d = diffWbs(existing, v1, { moduleIds: modules, protectedIds: none });
    expect(d.update).toEqual([]);
    expect(d.keptArchived).toBe(1);
    expect(d.create).toEqual([]);
  });

  it('nova versão do template só atualiza o que mudou; módulos não selecionados não são afetados', () => {
    const t2 = tpl('EAP-VERT', 'v2');
    t2.nodes.find((n) => n.key === 'cob')!.title = 'Cobertura e impermeabilização';
    const v2 = generateWbs(base, [{ moduleId: 'm1', template: t2 }]);
    const d = diffWbs(asExisting(v1), v2, { moduleIds: ['m1'], protectedIds: none });
    const titleChanges = d.update.filter((u) => u.changes.title);
    expect(titleChanges).toHaveLength(2); // uma cobertura por torre
    expect(titleChanges[0]!.changes.title).toEqual({ from: 'Cobertura', to: 'Cobertura e impermeabilização' });
    expect(d.remove).toEqual([]); // nós dos módulos m2 e m3 fora do escopo
  });
});
