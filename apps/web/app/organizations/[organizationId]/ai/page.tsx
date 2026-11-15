'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAiChat, useAiUsage } from '@/lib/ai/use-ai-chat';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, FormError } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { BudgetBar } from '@/components/ai/budget-bar';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export default function AiChatPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const chat = useAiChat(organizationId);
  const usage = useAiUsage(organizationId);
  const { membership } = useCurrentMembership(organizationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const userInitials = initials(membership?.user.name ?? '');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message) return;

    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');

    chat.mutate(message, {
      onSuccess: (result) => {
        setMessages((prev) => [...prev, { role: 'assistant', text: result.reply }]);
        usage.refetch();
      },
      onError: (error) => {
        const text = error instanceof ApiError ? error.message : 'Erro ao falar com o assistente.';
        setMessages((prev) => [...prev, { role: 'assistant', text: `⚠️ ${text}` }]);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">Assistente de IA</h1>

      <Card className="flex h-[32rem] flex-col p-0">
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-6 py-4 pb-4">
          <CardTitle className="text-base">Conversa</CardTitle>
          {usage.isSuccess && (
            <div className="w-48">
              <BudgetBar monthSpend={usage.data.monthSpend} monthlyBudget={usage.data.monthlyBudget} />
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Pergunte sobre seus clientes e tarefas — ex.: &ldquo;quais clientes estão sem contato há
              14 dias?&rdquo;
            </p>
          )}
          {messages.map((message, i) => (
            <div
              key={i}
              className={message.role === 'user' ? 'flex items-end justify-end gap-2' : 'flex items-end justify-start gap-2'}
            >
              {message.role === 'assistant' && (
                <Avatar size="sm">
                  <AvatarFallback>IA</AvatarFallback>
                </Avatar>
              )}
              <div
                className={
                  message.role === 'user'
                    ? 'max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'max-w-[80%] rounded-lg bg-ink-800 px-3 py-2 text-sm text-foreground'
                }
              >
                {message.text}
              </div>
              {message.role === 'user' && (
                <Avatar size="sm">
                  <AvatarFallback>{userInitials}</AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          {chat.isPending && <p className="text-sm text-muted-foreground">Pensando…</p>}
        </CardContent>

        <CardFooter className="border-t border-border px-6 py-4 pt-4">
          <form onSubmit={onSubmit} className="flex w-full gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escreva uma mensagem…"
              className="flex-1"
            />
            <Button type="submit" isLoading={chat.isPending}>
              Enviar
            </Button>
          </form>
        </CardFooter>
      </Card>
      <FormError message={usage.isError ? 'Não foi possível carregar o uso de IA deste mês.' : null} />
    </div>
  );
}
