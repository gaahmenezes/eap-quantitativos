/** Erros de aplicação mapeados para problem+json pelo ProblemFilter. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail ?? title);
  }
}

export const notFound = (what = 'Recurso') =>
  new AppError(404, 'NOT_FOUND', 'Não encontrado', `${what} não encontrado.`);
export const forbidden = (detail = 'Você não tem permissão para esta operação.') =>
  new AppError(403, 'FORBIDDEN', 'Acesso negado', detail);
export const unauthorized = (detail = 'Autenticação necessária.') =>
  new AppError(401, 'UNAUTHENTICATED', 'Não autenticado', detail);
export const conflict = (code: string, detail: string) =>
  new AppError(409, code, 'Conflito', detail);
export const versionConflict = () =>
  conflict(
    'VERSION_CONFLICT',
    'O registro foi alterado por outra pessoa. Recarregue os dados antes de salvar novamente.',
  );
export const badRequest = (code: string, detail: string) =>
  new AppError(400, code, 'Requisição inválida', detail);
