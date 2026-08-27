/**
 * Seed de desenvolvimento — cria uma organização de demonstração com um usuário
 * dono (OWNER), para não precisar recriar dados manualmente a cada teste do
 * fluxo de auth/organizations/RBAC. (planner, issue F1-17)
 *
 * Uso: `pnpm seed` (a partir da raiz) ou `pnpm --filter @opsmind/database run seed`.
 * Idempotente: pode ser rodado várias vezes sem duplicar a organização de demo.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'OpsMind Demo',
      slug: 'demo',
      plan: 'free',
      inactiveAfterDays: 14,
    },
  });

  const ownerPasswordHash = await hash('demo12345678');

  const owner = await prisma.user.upsert({
    where: { email: 'owner@opsmind.dev' },
    update: {},
    create: {
      email: 'owner@opsmind.dev',
      name: 'Demo Owner',
      passwordHash: ownerPasswordHash,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    update: {},
    create: {
      userId: owner.id,
      organizationId: org.id,
      role: 'OWNER',
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      actorType: 'SYSTEM',
      action: 'seed.applied',
      resource: `Organization:${org.id}`,
      metadata: { note: 'dev seed data created' },
    },
  });

  console.log(`Seed aplicado: organização "${org.name}" (${org.slug}), owner ${owner.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
