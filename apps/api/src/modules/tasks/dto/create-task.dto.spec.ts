import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateTaskDto, input);
  return validate(dto);
}

describe('CreateTaskDto', () => {
  it('aceita apenas o título (demais campos opcionais)', async () => {
    const errors = await validateInput({ title: 'Ligar para o cliente' });

    expect(errors).toHaveLength(0);
  });

  it('aceita todos os campos opcionais preenchidos', async () => {
    const errors = await validateInput({
      title: 'Ligar para o cliente',
      description: 'Follow-up da proposta',
      customerId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      assigneeId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      dueDate: '2026-09-01T12:00:00.000Z',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejeita título vazio', async () => {
    const errors = await validateInput({ title: '' });

    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('rejeita dueDate mal formada', async () => {
    const errors = await validateInput({ title: 'Ligar', dueDate: 'não-é-uma-data' });

    expect(errors.some((e) => e.property === 'dueDate')).toBe(true);
  });
});
