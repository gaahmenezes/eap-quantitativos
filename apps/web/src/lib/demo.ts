/**
 * Modo demonstração (somente leitura): o build roda sem API, respondendo com uma gravação de respostas
 * reais da API (snapshot.json), capturadas navegando pela aplicação com dados criados por ela.
 * Ativado só no build de demonstração (VITE_DEMO=1); o build normal não inclui nada disto em uso.
 */
export const DEMO = import.meta.env['VITE_DEMO'] === '1';

interface Recorded { status: number; body: unknown }
let snapshot: Record<string, Recorded> = {};
export let demoMeta: { recordedAt: string; requests: number } | null = null;

export async function loadSnapshot() {
  const res = await fetch('./snapshot.json');
  const data = (await res.json()) as { recordedAt: string; responses: Record<string, Recorded> };
  snapshot = data.responses;
  demoMeta = { recordedAt: data.recordedAt, requests: Object.keys(snapshot).length };
}

export const demoKey = (method: string, path: string, body?: string) => `${method} ${path}${body ? ` ${body}` : ''}`;

export function demoLookup(method: string, path: string, body?: string): Recorded | null {
  return snapshot[demoKey(method, path, body)] ?? null;
}

/** Primeira resposta gravada cuja chave começa com o prefixo (ex.: a aba gravada com outra linha de cabeçalho). */
export function demoFind(prefix: string): Recorded | null {
  const k = Object.keys(snapshot).find((x) => x === prefix || x.startsWith(`${prefix}?`) || x.startsWith(`${prefix} `));
  return k ? snapshot[k]! : null;
}
