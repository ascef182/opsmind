'use client';

import { apiUrl, refreshSession } from './api-client';
import { getStoredTokens } from './auth/token-storage';

export interface StreamMessage {
  event: string;
  id: string | null;
  data: string;
}

interface StreamOptions {
  onMessage: (message: StreamMessage) => void;
  onOpen?: () => void;
  onDisconnect?: () => void;
}

const MAX_BACKOFF_MS = 30_000;

// EventSource não envia o header Authorization; este leitor usa fetch + stream,
// renova o token em 401 e reconecta com backoff exponencial. Devolve a função
// que encerra o stream.
export function openAuthenticatedStream(path: string, options: StreamOptions): () => void {
  const controller = new AbortController();
  let backoff = 1_000;
  let stopped = false;

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        let token = getStoredTokens()?.accessToken;
        let response = await fetch(apiUrl(path), {
          headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controller.signal,
        });
        if (response.status === 401) {
          token = (await refreshSession()) ?? undefined;
          if (!token) return;
          response = await fetch(apiUrl(path), {
            headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
        }
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        backoff = 1_000;
        options.onOpen?.();
        await readEvents(response.body, options.onMessage);
      } catch {
        if (stopped) return;
      }
      options.onDisconnect?.();
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller.abort();
  };
}

async function readEvents(body: ReadableStream<Uint8Array>, onMessage: (message: StreamMessage) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const message = parseBlock(block);
      if (message) onMessage(message);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function parseBlock(block: string): StreamMessage | null {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, id, data: data.join('\n') };
}
