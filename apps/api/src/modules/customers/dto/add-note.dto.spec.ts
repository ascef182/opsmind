import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddNoteDto } from './add-note.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(AddNoteDto, input);
  return validate(dto);
}

describe('AddNoteDto', () => {
  it('aceita uma nota não vazia', async () => {
    const errors = await validateInput({ note: 'Ligou hoje, interessado em upgrade' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita nota vazia', async () => {
    const errors = await validateInput({ note: '' });

    expect(errors.some((e) => e.property === 'note')).toBe(true);
  });
});
