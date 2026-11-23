/**
 * Seed de DESENVOLVIMENTO: organização e usuário de demonstração.
 * Recusa executar em produção. Dados de cenário (Testes A–D) entram nas fases seguintes.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/password.js';

if (process.env['NODE_ENV'] === 'production') {
  console.error('Seed de desenvolvimento não pode ser executado em produção.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }),
});
const email = process.env['SEED_EMAIL'] ?? 'demo@eapq.local';
const password = process.env['SEED_PASSWORD'] ?? 'demo-senha-local-123';

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log(`Usuário ${email} já existe — nada a fazer.`);
} else {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: 'Organização de Demonstração' } });
    const user = await tx.user.create({ data: { email, name: 'Usuário Demo', passwordHash } });
    await tx.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } });
    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: user.id,
        entityType: 'Organization',
        entityId: org.id,
        action: 'SEED',
        after: { name: org.name },
      },
    });
  });
  console.log(`Criado ${email} (senha de desenvolvimento definida por SEED_PASSWORD ou padrão local).`);
}
await prisma.$disconnect();
