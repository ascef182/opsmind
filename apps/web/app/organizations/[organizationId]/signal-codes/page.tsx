'use client';

import { useParams } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useConfirmSignalCode, useSignalCodes } from '@/lib/leads/use-signal-codes';
import { SIGNAL_CODE_CONFIRM_ROLES } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Tela de REVISÃO apenas — listar + confirmar um `SignalCode` que uma tool
// de IA propôs (Task 2). Sem criação manual nesta sprint (YAGNI até
// aparecer necessidade real de um formulário), espelha o comentário no topo
// de `outreach.service.ts`: a única ação de escrita aqui é humana.
export default function SignalCodesPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canConfirm = membership ? SIGNAL_CODE_CONFIRM_ROLES.includes(membership.role) : false;

  const codes = useSignalCodes(organizationId);
  const confirmCode = useConfirmSignalCode(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Códigos de sinal</h1>
      </div>

      <FormError message={confirmCode.isError ? (confirmCode.error as ApiError).message : null} />

      {codes.isLoading && <p className="text-muted-foreground">Carregando códigos…</p>}
      {codes.isSuccess && codes.data.length === 0 && (
        <p className="text-muted-foreground">Nenhum código de sinal cadastrado ainda.</p>
      )}

      {codes.isSuccess && codes.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Código</TableHead>
                <TableHead>Rótulo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.data.map((code) => (
                <TableRow key={code.code}>
                  <TableCell className="font-medium text-foreground">{code.code}</TableCell>
                  <TableCell className="text-foreground/80">{code.label}</TableCell>
                  <TableCell className="text-foreground/80">{code.category}</TableCell>
                  <TableCell>
                    <Badge value={code.status} />
                  </TableCell>
                  <TableCell className="text-foreground/80">
                    {new Date(code.createdAt).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    {canConfirm && code.status === 'PROPOSED' && (
                      <Button
                        size="sm"
                        isLoading={confirmCode.isPending && confirmCode.variables === code.code}
                        onClick={() => confirmCode.mutate(code.code)}
                      >
                        Confirmar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
