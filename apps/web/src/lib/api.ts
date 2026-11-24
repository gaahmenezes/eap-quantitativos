import type { ProblemDetails } from '@eapq/contracts';

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
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} });
  if (!res.ok) return failure(res);
  return (await res.json()) as T;
}

/** Baixa um arquivo gerado pela API (exportações) e oferece para salvar. */
export async function downloadFile(method: 'GET' | 'POST', path: string, body?: unknown): Promise<void> {
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
