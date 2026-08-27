'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAiChat, useAiUsage } from '@/lib/ai/use-ai-chat';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export default function AiChatPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const chat = useAiChat(organizationId);
  const usage = useAiUsage(organizationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Assistente de IA</h1>
        {usage.isSuccess && (
          <span className="text-xs text-slate-400">
            gasto estimado este mês: ${usage.data.monthSpend.toFixed(4)}
          </span>
        )}
      </div>

      <Card className="flex h-[28rem] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {messages.length === 0 && (
            <p className="text-sm text-slate-400">
              Pergunte sobre seus clientes e tarefas — ex.: &ldquo;quais clientes estão sem contato há
              14 dias?&rdquo;
            </p>
          )}
          {messages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-[80%] rounded-lg bg-brand-600 px-3 py-2 text-sm text-white'
                  : 'mr-auto max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800'
              }
            >
              {message.text}
            </div>
          ))}
          {chat.isPending && <p className="text-sm text-slate-400">Pensando…</p>}
        </div>

        <form onSubmit={onSubmit} className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escreva uma mensagem…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <Button type="submit" isLoading={chat.isPending}>
            Enviar
          </Button>
        </form>
      </Card>
      <FormError message={usage.isError ? 'Não foi possível carregar o uso de IA deste mês.' : null} />
    </div>
  );
}
