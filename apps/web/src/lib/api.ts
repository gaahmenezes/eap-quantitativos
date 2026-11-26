import type { ProblemDetails } from '@eapq/contracts';
import { DEMO, demoLookup } from './demo';

/** Erro HTTP tipado a partir do problem+json da API. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
  get status() {
    return this.problem.status;
  }
  get code() {
    return this.problem.code;
  }
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function api<T>(
  method: Method,
  path: string,
  opts: { body?: unknown; version?: number; signal?: AbortSignal } = {},
): Promise<T> {
  if (DEMO) return demoCall<T>(method, path, opts.body);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.version !== undefined) headers['If-Match'] = String(opts.version);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError({
      type: 'about:blank#NETWORK',
      title: 'Sem conexão',
      status: 0,
      code: 'NETWORK',
      detail: 'Não foi possível contatar o servidor. Verifique sua conexão e tente novamente.',
    });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const p = (data ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({
      type: p.type ?? 'about:blank',
      title: p.title ?? 'Erro',
      status: res.status,
      code: p.code ?? `HTTP_${res.status}`,
      detail: p.detail ?? `Erro ${res.status}`,
      errors: p.errors,
      requestId: p.requestId,
    });
  }
  return data as T;
}

export const errorMessage = (e: unknown): string =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Erro inesperado.';

async function failure(res: Response): Promise<never> {
  const text = await res.text();
  let p: Partial<ProblemDetails> = {};
  try { p = text ? (JSON.parse(text) as Partial<ProblemDetails>) : {}; } catch { /* corpo não JSON */ }
  throw new ApiError({ type: p.type ?? 'about:blank', title: p.title ?? 'Erro', status: res.status, code: p.code ?? `HTTP_${res.status}`, detail: p.detail ?? `Erro ${res.status}`, errors: p.errors, requestId: p.requestId });
}

/** Envio de arquivo (multipart) com CSRF. */
export async function uploadFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  if (DEMO) {
    // demonstração: a migração de planilhas lê o arquivo aqui no navegador (nada é enviado)
    const m = /^\/projects\/([^/]+)\/workbook-imports$/.exec(path);
    if (!m) throw readOnly();
    const { demoUpload } = await import('./demo-migration');
    return (await demoGuard(() => demoUpload(m[1]!, file))) as T;
  }
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} });
  if (!res.ok) return failure(res);
  return (await res.json()) as T;
}

/** Baixa um arquivo gerado pela API (exportações) e oferece para salvar. */
export async function downloadFile(method: 'GET' | 'POST', path: string, body?: unknown): Promise<void> {
  if (DEMO) throw readOnly();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) return failure(res);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? 'arquivo');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const readOnly = () => new ApiError({ type: 'about:blank#DEMO', title: 'Demonstração', status: 403, code: 'DEMO_READ_ONLY', detail: 'Esta é uma demonstração somente leitura: alterações, envios e downloads não são feitos aqui.' });

/** Demonstração: responde com a gravação; o que não foi gravado aparece como indisponível. */
async function demoGuard<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    const { DemoProblem } = await import('./demo-migration');
    if (e instanceof DemoProblem) throw new ApiError({ type: `about:blank#${e.code}`, title: e.title, status: e.status, code: e.code, detail: e.detail, errors: e.errors });
    throw e;
  }
}

async function demoCall<T>(method: Method, path: string, body: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  if (path.includes('/workbook-imports')) {
    const { demoMigration } = await import('./demo-migration');
    const live = await demoGuard(() => demoMigration(method, path, body));
    if (live) return live.body as T;
  }
  const rec = demoLookup(method, path, body !== undefined ? JSON.stringify(body) : undefined);
  if (!rec) {
    if (method !== 'GET' && !path.endsWith('/consolidation') && !path.endsWith('/consolidation/lines') && !path.endsWith('/preview')) throw readOnly();
    throw new ApiError({ type: 'about:blank#DEMO', title: 'Demonstração', status: 404, code: 'DEMO_NOT_RECORDED', detail: 'Esta consulta não faz parte da demonstração gravada. Na aplicação real ela é calculada na hora.' });
  }
  if (rec.status >= 400) {
    const p = (rec.body ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({ type: p.type ?? 'about:blank', title: p.title ?? 'Erro', status: rec.status, code: p.code ?? `HTTP_${rec.status}`, detail: p.detail ?? `Erro ${rec.status}`, errors: p.errors });
  }
  return (rec.status === 204 ? undefined : rec.body) as T;
}
