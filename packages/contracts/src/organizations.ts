import { z } from 'zod';
import { email } from './auth.js';

export const orgRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const projectRoleSchema = z.enum(['COORDINATOR', 'EDITOR', 'VIEWER']);

export const createInvitationSchema = z.object({ email, role: orgRoleSchema });
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const updateMemberRoleSchema = z.object({ role: orgRoleSchema });

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: z.infer<typeof orgRoleSchema>;
  status: 'ACTIVE' | 'DISABLED';
}

export interface InvitationDto {
  id: string;
  email: string;
  role: z.infer<typeof orgRoleSchema>;
  expiresAt: string;
  acceptedAt: string | null;
  /** Presente apenas na resposta de criação: o token não é armazenado em claro. */
  token?: string;
}
