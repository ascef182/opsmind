/**
 * Seed opcional do OpsGov para uma organização existente (CazaTech): regime
 * SIMEI vigente, cadastro MEI (se o CNPJ for informado), os CNAEs atuais e as
 * decisões pendentes com o contador (DEFAULT_ACCOUNTING_DECISIONS).
 *
 * Uso: pnpm --filter @opsmind/database seed:opsgov -- --org <slug> --since AAAA-MM-DD [--cnpj <cnpj>]
 *
 * Idempotente: não grava nada numa tabela de vigência que já tenha registros
 * da organização — histórico existente nunca é tocado. A atividade principal
 * e o grupo de receita de cada CNAE são o ponto de partida mais provável e
 * devem ser conferidos na tela (uma correção vira nova versão, não edição).
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ACCOUNTING_DECISIONS, normalizeCnpj } from '@opsmind/shared-types';

const CNAES = [
  { cnae: '8219-9/99', description: 'Preparação de documentos e serviços especializados de apoio administrativo', isPrimary: true, revenueGroup: 'TRADUCAO_LEGENDAGEM' },
  { cnae: '8599-6/99', description: 'Outras atividades de ensino não especificadas anteriormente', isPrimary: false, revenueGroup: 'OUTROS' },
  { cnae: '8230-0/01', description: 'Serviços de organização de feiras, congressos, exposições e festas', isPrimary: false, revenueGroup: 'OUTROS' },
] as const;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const prisma = new PrismaClient();

async function main() {
  const slug = arg('org');
  const since = arg('since');
  if (!slug || !since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error('Uso: seed:opsgov -- --org <slug> --since AAAA-MM-DD [--cnpj <cnpj>]');
  }
  const rawCnpj = arg('cnpj');
  const cnpj = rawCnpj ? normalizeCnpj(rawCnpj) : null;
  if (rawCnpj && !cnpj) throw new Error('CNPJ inválido');

  const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
  const validFrom = new Date(since);
  const actor = { actorType: 'SYSTEM' as const, actorId: null };

  await prisma.$transaction(async (tx) => {
    if ((await tx.taxRegimePeriod.count({ where: { organizationId: org.id } })) === 0) {
      await tx.taxRegimePeriod.create({
        data: { organizationId: org.id, regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom, notes: 'Seed OpsGov', ...actor },
      });
      console.log('regime SIMEI criado');
    }
    if (cnpj && (await tx.companyRegistrationPeriod.count({ where: { organizationId: org.id } })) === 0) {
      await tx.companyRegistrationPeriod.create({
        data: { organizationId: org.id, naturezaJuridica: 'MEI', cnpj, validFrom, notes: 'Seed OpsGov', ...actor },
      });
      console.log('cadastro MEI criado');
    }
    if ((await tx.companyActivity.count({ where: { organizationId: org.id } })) === 0) {
      await tx.companyActivity.createMany({
        data: CNAES.map((c) => ({ organizationId: org.id, ...c, validFrom, ...actor })),
      });
      console.log(`${CNAES.length} CNAEs criados`);
    }
    const decisions = await tx.accountingDecision.createMany({
      data: DEFAULT_ACCOUNTING_DECISIONS.map((d) => ({
        organizationId: org.id,
        seedKey: d.key,
        topic: d.topic,
        question: d.question,
        ...actor,
      })),
      skipDuplicates: true,
    });
    if (decisions.count > 0) console.log(`${decisions.count} decisões com o contador criadas`);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
