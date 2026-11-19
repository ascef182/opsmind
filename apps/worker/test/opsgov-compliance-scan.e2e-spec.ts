import { randomUUID } from 'crypto';
import { validateEnv } from '@opsmind/config/env/schema';
import { addDays, fromDateKey, todayInSaoPaulo } from '@opsmind/shared-types';
import { createPrismaClient } from '../src/tenant-context';
import { scanComplianceReminders } from '../src/opsgov-compliance-scan';

// OpsGov Fase 4 contra Postgres real: lembretes de obrigação/certidão viram
// notificação para OWNER/ADMIN uma única vez por vencimento+offset, mesmo com
// várias passadas do scan.
describe('OpsGov compliance reminders (e2e)', () => {
  const env = validateEnv(process.env);
  const prisma = createPrismaClient(env);
  const today = todayInSaoPaulo();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixtures() {
    const suffix = randomUUID();
    const organization = await prisma.organization.create({ data: { name: 'OpsGov Reminders', slug: `opsgov-rem-${suffix}` } });
    const roles = ['OWNER', 'ADMIN', 'MEMBER'] as const;
    const users = await Promise.all(
      roles.map((role) =>
        prisma.user.create({ data: { email: `opsgov-rem-${role}-${suffix}@opsmind.test`, passwordHash: 'x', name: role } }),
      ),
    );
    await prisma.membership.createMany({
      data: users.map((user, i) => ({ userId: user.id, organizationId: organization.id, role: roles[i]! })),
    });
    return { organization, owner: users[0]!, admin: users[1]!, member: users[2]! };
  }

  it('notifica OWNER/ADMIN uma vez por vencimento, e de novo no próximo vencimento', async () => {
    const { organization, owner, admin, member } = await fixtures();
    const base = { organizationId: organization.id, actorType: 'SYSTEM' as const };
    const obligation = await prisma.complianceObligation.create({
      data: { ...base, type: 'DAS', title: 'DAS mensal', recurrence: 'MONTHLY', dueDay: 20, nextDueDate: fromDateKey(addDays(today, 1)) },
    });
    await prisma.certificate.create({
      data: { ...base, type: 'CND_FEDERAL', issuedOn: fromDateKey(addDays(today, -170)), validUntil: fromDateKey(today) },
    });
    // Certidão FGTS antiga já substituída por uma nova válida: não deve avisar.
    await prisma.certificate.create({
      data: { ...base, type: 'FGTS_CRF', issuedOn: fromDateKey(addDays(today, -40)), validUntil: fromDateKey(addDays(today, 2)) },
    });
    await prisma.certificate.create({
      data: { ...base, type: 'FGTS_CRF', issuedOn: fromDateKey(today), validUntil: fromDateKey(addDays(today, 30)) },
    });

    const count = () => prisma.notification.count({ where: { organizationId: organization.id } });

    await scanComplianceReminders(prisma, today);
    expect(await count()).toBe(4); // (obrigação D-1 + CND D-0) × (OWNER, ADMIN)
    const recipients = await prisma.notification.findMany({ where: { organizationId: organization.id }, select: { userId: true, type: true } });
    expect(new Set(recipients.map((n) => n.userId))).toEqual(new Set([owner.id, admin.id]));
    expect(recipients.some((n) => n.userId === member.id)).toBe(false);
    expect(new Set(recipients.map((n) => n.type))).toEqual(new Set(['opsgov.obligation_due', 'opsgov.certificate_expiring']));

    // Segunda e terceira passadas: nada novo.
    await scanComplianceReminders(prisma, today);
    await Promise.all([scanComplianceReminders(prisma, today), scanComplianceReminders(prisma, today)]);
    expect(await count()).toBe(4);
    expect(await prisma.complianceReminder.count({ where: { organizationId: organization.id } })).toBe(2);

    // Vencimento cumprido e avançado: o novo vencimento ganha seus próprios lembretes.
    await prisma.complianceObligation.update({ where: { id: obligation.id }, data: { nextDueDate: fromDateKey(addDays(today, 7)) } });
    await scanComplianceReminders(prisma, today);
    expect(await count()).toBe(6);
  });
});
