import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS } from '../units/units.js';
import { computeSchedule, totalWithMultipliers, type ScheduleRowInput, type ScheduleService } from './schedule.js';

const U = (s: string) => DEFAULT_UNITS.find((u) => u.symbol === s)!;
const svc = (id: string, code: string, unit: string): ScheduleService => ({ id, code, unit: U(unit) });
const services = new Map([
  svc('esq-un', 'ESQ.010', 'un'), svc('esq-m2', 'ESQ.002', 'm²'), svc('tubo100', 'HID.100', 'm'), svc('anel50', 'HID.050', 'un'),
  svc('fio15', 'ELE.015', 'm'), svc('fio25', 'ELE.025', 'm'), svc('massa', 'X.KG', 'kg'),
].map((s) => [s.id, s]));
const cols = [{ key: 'casa', label: 'Casa tipo' }];
const row = (key: string, o: Partial<ScheduleRowInput> & { qty?: string }): ScheduleRowInput => ({ key, description: o.description ?? key, unit: o.unit ?? 'un', serviceIds: o.serviceIds ?? [], cells: o.cells ?? { casa: o.qty ?? '' }, ...o });
const run = (rows: ScheduleRowInput[], columns = cols) => computeSchedule(columns, rows, services, DEFAULT_UNITS);

describe('quadro de esquadrias — Viva Mais Barra (Esquadrias AL, 362 casas)', () => {
  const r = run([
    row('pa1', { code: 'PA1', description: 'Porta de alumínio', width: '0.8', height: '2.3', qty: '1', serviceIds: ['esq-un', 'esq-m2'] }),
    row('pv1', { code: 'PV1', description: 'Porta de vidro', width: '2.6', height: '2.3', qty: '1', serviceIds: ['esq-un', 'esq-m2'] }),
    row('j01', { code: 'J01', description: 'Janela', width: '1.6', height: '1.2', qty: '2', serviceIds: ['esq-un', 'esq-m2'] }),
    row('j02', { code: 'J02', description: 'Janela', width: '0.6', height: '0.6', qty: '2', serviceIds: ['esq-un', 'esq-m2'] }),
    row('j03', { code: 'J03', description: 'Janela', width: '1.2', height: '0.6', qty: '1', serviceIds: ['esq-un', 'esq-m2'] }),
  ]);
  it('área por casa 13,1 m² e 7 peças; por obra 4.742,2 m² e 2.534 un', () => {
    expect(r.errorCount).toBe(0);
    const area = r.plans.find((p) => p.serviceId === 'esq-m2')!;
    const un = r.plans.find((p) => p.serviceId === 'esq-un')!;
    expect(area).toMatchObject({ quantity: '13.1', unit: 'm²', columnKey: 'casa' });
    expect(un.quantity).toBe('7');
    expect(totalWithMultipliers([{ quantity: area.quantity, multiplier: 362 }])).toBe('4742.2');
    expect(totalWithMultipliers([{ quantity: un.quantity, multiplier: 362 }])).toBe('2534');
  });
  it('memória do resumo lista cada item com L × A', () => {
    const area = r.plans.find((p) => p.serviceId === 'esq-m2')!;
    expect(area.contributions.find((c) => c.code === 'J01')).toEqual({ rowKey: 'j01', code: 'J01', description: 'Janela', spec: null, entered: '2', enteredUnit: 'un', perItem: '1.92', value: '3.84' });
    expect(totalWithMultipliers([{ quantity: area.contributions.find((c) => c.code === 'J01')!.value, multiplier: 362 }])).toBe('1390.08');
  });
  it('serviço em área sem largura/altura é erro do item', () => {
    const x = run([row('p', { description: 'Porta', qty: '1', serviceIds: ['esq-m2'] })]);
    expect(x.rows[0]!.errors[0]).toMatch(/informe largura e altura/);
    expect(x.plans).toEqual([]);
  });
});

describe('materiais de instalações — hidráulica e elétrica por casa', () => {
  it('tubo em m e anel em un; × 362 = 9.122,4 m e 9.774 un', () => {
    const r = run([
      row('t', { description: 'Tubo PVC rígido', spec: '100 mm', unit: 'm', qty: '25,2', serviceIds: ['tubo100'] }),
      row('a', { description: 'Anel de borracha', spec: '50 mm', qty: '27', serviceIds: ['anel50'] }),
    ]);
    expect(totalWithMultipliers([{ quantity: r.plans.find((p) => p.serviceId === 'tubo100')!.quantity, multiplier: 362 }])).toBe('9122.4');
    expect(totalWithMultipliers([{ quantity: r.plans.find((p) => p.serviceId === 'anel50')!.quantity, multiplier: 362 }])).toBe('9774');
  });
  it('quadro de resumo: fios de cores diferentes somam no mesmo serviço (152,6 m), sem dupla medição', () => {
    const r = run([
      row('v', { description: 'Fio 1,5 mm²', spec: 'vermelho', unit: 'm', qty: '56,5', serviceIds: ['fio15'] }),
      row('az', { description: 'Fio 1,5 mm²', spec: 'azul claro', unit: 'm', qty: '34,3', serviceIds: ['fio15'] }),
      row('b', { description: 'Fio 1,5 mm²', spec: 'branco', unit: 'm', qty: '61,8', serviceIds: ['fio15'] }),
      row('v25', { description: 'Fio 2,5 mm²', spec: 'vermelho', unit: 'm', qty: '129,1', serviceIds: ['fio25'] }),
    ]);
    expect(r.plans.map((p) => [p.serviceId, p.quantity, p.contributions.length])).toEqual([['fio15', '152.6', 3], ['fio25', '129.1', 1]]);
  });
  it('comprimento digitado em cm convertido para m; conta na célula', () => {
    const r = run([row('t', { description: 'Tubo', unit: 'cm', qty: '250+50', serviceIds: ['tubo100'] })]);
    expect(r.plans[0]!.quantity).toBe('3');
    expect(r.rows[0]!.cells.casa).toEqual({ value: '300', expr: '250+50' });
  });
});

describe('destinos e validação', () => {
  const two = [{ key: 'a', label: 'Casa A' }, { key: 'b', label: 'Casa B' }];
  it('um plano por serviço × destino; destino vazio ou zero não gera plano', () => {
    const r = run([row('x', { description: 'Vaso sanitário', serviceIds: ['esq-un'], cells: { a: '2', b: '0' } }), row('y', { description: 'Lavatório', serviceIds: ['esq-un'], cells: { b: '1' } })], two);
    expect(r.plans.map((p) => [p.columnKey, p.quantity])).toEqual([['a', '2'], ['b', '1']]);
  });
  it('erros: unidade incompatível, valor inválido, negativo, sem serviço, sem descrição', () => {
    const r = run([
      row('1', { description: 'Tubo', unit: 'm', qty: '3', serviceIds: ['massa'] }),
      row('2', { description: 'Peça', qty: 'abc', serviceIds: ['esq-un'] }),
      row('3', { description: 'Peça', qty: '-2', serviceIds: ['esq-un'] }),
      row('4', { description: 'Peça', qty: '2' }),
      row('5', { description: ' ', qty: '' }),
    ]);
    expect(r.rows.map((x) => x.errors.join(' '))).toEqual([
      expect.stringContaining('incompatível'), expect.stringContaining('Digite um número'), expect.stringContaining('negativa'), 'Escolha o serviço do item.', 'Informe a descrição.',
    ]);
    expect(r.errorCount).toBe(5);
    expect(r.plans).toEqual([]);
  });
});
