import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidDateKey, isValidMonthKey } from '@opsmind/shared-types';

// Datas de negócio trafegam como 'YYYY-MM-DD' (dia do calendário), nunca como
// ISO com hora — evita o deslocamento de fuso que faria um vencimento de
// "dia 5" virar "dia 4" em São Paulo. Ver packages/shared-types/src/finance.ts.
export function IsDateKey(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDateKey',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} deve ser uma data válida no formato AAAA-MM-DD`, ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && isValidDateKey(value) },
    });
}

export function IsMonthKey(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isMonthKey',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} deve ser um mês válido no formato AAAA-MM`, ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && isValidMonthKey(value) },
    });
}
