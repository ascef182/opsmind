'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRegister } from '@/lib/auth/use-auth';
import { getStoredTokens } from '@/lib/auth/token-storage';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, FormError } from '@/components/ui/card';

// Espelha as regras de RegisterDto (apps/api) — não substitui a validação do
// servidor, só evita uma ida e volta de rede pra erros óbvios.
const registerSchema = z.object({
  name: z.string().min(1, 'Informe seu nome'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'Mínimo de 8 caracteres'),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const registerUser = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  useEffect(() => {
    if (getStoredTokens() !== null) {
      router.replace('/organizations');
    }
  }, [router]);

  const onSubmit = handleSubmit((values) => {
    registerUser.mutate(values, { onSuccess: () => router.push('/organizations') });
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-900">Criar conta no OpsMind</h1>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <Input placeholder="Seu nome" {...register('name')} />
            <FormError message={errors.name?.message} />
          </div>
          <div>
            <Input type="email" placeholder="voce@empresa.com" {...register('email')} />
            <FormError message={errors.email?.message} />
          </div>
          <div>
            <Input type="password" placeholder="Senha (mín. 8 caracteres)" {...register('password')} />
            <FormError message={errors.password?.message} />
          </div>
          <FormError message={registerUser.isError ? (registerUser.error as ApiError).message : null} />
          <Button type="submit" isLoading={registerUser.isPending}>
            Criar conta
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          Já tem conta?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Entrar
          </Link>
        </p>
      </Card>
    </main>
  );
}
