import { pickRoundRobinAssignee } from './lead-routing';

describe('pickRoundRobinAssignee', () => {
  it('escolhe o candidato com menos leads em aberto', () => {
    const result = pickRoundRobinAssignee([
      { userId: 'user-a', openLeadCount: 5 },
      { userId: 'user-b', openLeadCount: 2 },
      { userId: 'user-c', openLeadCount: 8 },
    ]);

    expect(result).toBe('user-b');
  });

  it('empate: mantém o primeiro candidato da lista (ordem decidida pelo chamador, ex. Membership.createdAt)', () => {
    const result = pickRoundRobinAssignee([
      { userId: 'user-a', openLeadCount: 3 },
      { userId: 'user-b', openLeadCount: 3 },
    ]);

    expect(result).toBe('user-a');
  });

  it('retorna null quando não há nenhum candidato (organização sem membros elegíveis)', () => {
    expect(pickRoundRobinAssignee([])).toBeNull();
  });

  it('um único candidato sempre recebe, independente da carga', () => {
    expect(pickRoundRobinAssignee([{ userId: 'user-a', openLeadCount: 100 }])).toBe('user-a');
  });
});
