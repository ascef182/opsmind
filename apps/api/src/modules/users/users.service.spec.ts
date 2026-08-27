import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it('busca o usuário pelo id via PrismaService', async () => {
      const user = { id: 'user-1', email: 'a@b.com' };
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(result).toBe(user);
    });
  });

  describe('findByEmail', () => {
    it('busca o usuário pelo email via PrismaService', async () => {
      const user = { id: 'user-1', email: 'a@b.com' };
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.findByEmail('a@b.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
      expect(result).toBe(user);
    });

    it('retorna null quando não existe usuário com o email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('missing@b.com');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('cria o usuário com os dados informados', async () => {
      const input = { email: 'a@b.com', name: 'A', passwordHash: 'hashed' };
      const created = { id: 'user-1', ...input };
      prisma.user.create.mockResolvedValue(created);

      const result = await service.create(input);

      expect(prisma.user.create).toHaveBeenCalledWith({ data: input });
      expect(result).toBe(created);
    });
  });

  describe('markEmailVerified', () => {
    it('marca o email como verificado com a data atual', async () => {
      const updated = { id: 'user-1', emailVerifiedAt: new Date() };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.markEmailVerified('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(result).toBe(updated);
    });
  });
});
