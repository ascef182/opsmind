'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLogin } from '@/lib/auth/use-auth';
import { getStoredTokens } from '@/lib/auth/token-storage';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, FormError } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe sua senha'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (getStoredTokens() !== null) {
      router.replace('/organizations');
    }
  }, [router]);

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, { onSuccess: () => router.push('/organizations') });
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-900">Entrar no OpsMind</h1>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <Input type="email" placeholder="voce@empresa.com" {...register('email')} />
            <FormError message={errors.email?.message} />
          </div>
          <div>
            <Input type="password" placeholder="Senha" {...register('password')} />
            <FormError message={errors.password?.message} />
          </div>
          <FormError message={login.isError ? (login.error as ApiError).message : null} />
          <Button type="submit" isLoading={login.isPending}>
            Entrar
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          Não tem conta?{' '}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            Criar conta
          </Link>
        </p>
      </Card>
    </main>
  );
}
