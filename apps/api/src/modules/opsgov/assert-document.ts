import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service';

/** Comprovante opcional: precisa ser um documento vivo da MESMA organização. */
export async function assertDocumentOfOrganization(
  prisma: PrismaService,
  organizationId: string,
  documentId: string | undefined | null,
): Promise<void> {
  if (!documentId) return;
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!document) throw new NotFoundException('Documento comprobatório não encontrado');
}
