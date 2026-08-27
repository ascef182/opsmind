import { Injectable } from '@nestjs/common';
import type { User } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
}

/**
 * Mínimo necessário para `modules/auth` (Passo 5): sem repository layer
 * (Decisão #12 do blueprint) — chama `PrismaService` diretamente.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({ data: input });
  }

  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }
}
