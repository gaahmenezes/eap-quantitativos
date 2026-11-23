import { useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  acceptInvitationSchema,
  loginSchema,
  signupSchema,
  type AcceptInvitationInput,
  type LoginInput,
  type SignupInput,
} from '@eapq/contracts';
import { api, ApiError, errorMessage, setCsrfToken } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { TextField } from '../../components/ui/field';
import { Notice } from '../../components/ui/feedback';
import { useSession } from './session';

/** Aplica erros de campo vindos da API (422) ao formulário; retorna a mensagem geral. */
export function applyServerErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>): string {
  if (e instanceof ApiError) {
    for (const [path, message] of Object.entries(e.fieldErrors())) {
      if (path) setError(path as Path<T>, { message });
    }
  }
  return errorMessage(e);
}

function AuthFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-graphite-900 px-4 py-10">
      <div className="w-full max-w-[420px]">
        <p className="mb-6 font-display text-[22px] font-semibold text-white">EAP Quantitativos</p>
        <div className="border border-graphite-800 bg-sheet">
          <h1 className="border-b border-line px-6 py-4 font-display text-[22px] font-semibold">{title}</h1>
          <div className="px-6 py-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-[14px] text-graphite-400">{footer}</div>}
      </div>
    </div>
  );
}

function useAfterAuth() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  return async (csrf: string, to = '/') => {
    setCsrfToken(csrf);
    await refresh();
    navigate(to, { replace: true });
  };
}

export function LoginPage() {
  const { me } = useSession();
  const after = useAfterAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  if (me) return <Navigate to="/" replace />;
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>('POST', '/auth/login', { body: values });
      await after(r.csrfToken, params.get('voltar') ?? '/');
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <AuthFrame title="Entrar" footer={<>Nova organização? <Link to="/criar-conta" className="text-white underline">Criar conta</Link></>}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="E-mail" type="email" autoComplete="username" autoFocus {...form.register('email')} error={form.formState.errors.email?.message} />
        <TextField label="Senha" type="password" autoComplete="current-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>Entrar</Button>
      </form>
    </AuthFrame>
  );
}

export function SignupPage() {
  const after = useAfterAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>('POST', '/auth/signup', { body: values });
      await after(r.csrfToken);
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  return (
    <AuthFrame title="Criar organização" footer={<>Já tem conta? <Link to="/entrar" className="text-white underline">Entrar</Link></>}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nome da organização" {...form.register('organizationName')} error={e.organizationName?.message} hint="Ex.: nome da construtora ou do escritório" />
        <TextField label="Seu nome" autoComplete="name" {...form.register('name')} error={e.name?.message} />
        <TextField label="E-mail" type="email" autoComplete="email" {...form.register('email')} error={e.email?.message} />
        <TextField label="Senha" type="password" autoComplete="new-password" {...form.register('password')} error={e.password?.message} hint="Ao menos 12 caracteres" />
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>Criar organização</Button>
      </form>
    </AuthFrame>
  );
}

export function AcceptInvitationPage() {
  const after = useAfterAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';
  const form = useForm<AcceptInvitationInput>({ resolver: zodResolver(acceptInvitationSchema), defaultValues: { token } });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>('POST', '/auth/accept-invitation', { body: values });
      await after(r.csrfToken);
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  if (!token) {
    return (
      <AuthFrame title="Convite">
        <Notice tone="danger">Link de convite incompleto. Peça ao administrador um novo link.</Notice>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Aceitar convite">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <input type="hidden" {...form.register('token')} />
        <TextField label="Seu nome" autoComplete="name" {...form.register('name')} error={e.name?.message} />
        <TextField label="Senha" type="password" autoComplete="new-password" {...form.register('password')} error={e.password?.message} hint="Ao menos 12 caracteres. Se você já tem conta com este e-mail, use a senha atual." />
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>Aceitar convite</Button>
      </form>
    </AuthFrame>
  );
}
