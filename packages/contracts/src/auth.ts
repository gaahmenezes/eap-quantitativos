import { z } from 'zod';
import { requiredText } from './common.js';

export const email = z.email('E-mail inválido').trim().toLowerCase().max(254);
/** Política mínima (ASVS 2.1): 12+ caracteres, sem regras de composição. */
export const password = z
  .string()
  .min(12, 'A senha deve ter ao menos 12 caracteres')
  .max(128, 'A senha deve ter no máximo 128 caracteres');

export const signupSchema = z.object({
  organizationName: requiredText(120),
  name: requiredText(120),
  email,
  password,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: requiredText(120),
  password,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export interface MeResponse {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string };
  orgRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  permissions: string[];
  csrfToken: string;
}
