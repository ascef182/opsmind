import { tenantContextStorage } from './tenant-context.storage';

// Efeitos que só podem acontecer depois que a transação da request confirmar
// (ex.: publicar um evento em tempo real). Fora de uma request (consumers de
// fila), a escrita já foi confirmada e o efeito roda na hora.
const pending = new WeakMap<object, (() => void | Promise<void>)[]>();

export function runAfterCommit(effect: () => void | Promise<void>): void {
  const tx = tenantContextStorage.getStore();
  if (!tx) {
    void Promise.resolve().then(effect).catch(() => undefined);
    return;
  }
  const list = pending.get(tx) ?? [];
  list.push(effect);
  pending.set(tx, list);
}

export async function flushAfterCommit(tx: object): Promise<void> {
  const list = pending.get(tx);
  pending.delete(tx);
  for (const effect of list ?? []) {
    try {
      await effect();
    } catch {
      // Efeito pós-commit nunca derruba a resposta já confirmada.
    }
  }
}

export function discardAfterCommit(tx: object): void {
  pending.delete(tx);
}
