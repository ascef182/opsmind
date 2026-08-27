import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Hash de senha com Argon2id (Decisão #6 do blueprint — docs/planning/reviews/
 * code-architect-review.md). `argon2.hash` já usa argon2id com parâmetros
 * seguros por padrão; nenhuma opção extra é necessária no MVP.
 */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
