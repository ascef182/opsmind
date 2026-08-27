import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTaskDto } from './update-task.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateTaskDto, input);
  return validate(dto);
}

describe('UpdateTaskDto', () => {
  it('aceita objeto vazio — toda atualização é parcial', async () => {
    const errors = await validateInput({});

    expect(errors).toHaveLength(0);
  });

  it('aceita uma transição de status válida', async () => {
    const errors = await validateInput({ status: 'DONE' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita status fora da lista de valores válidos', async () => {
    const errors = await validateInput({ status: 'ARCHIVED' });

    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
