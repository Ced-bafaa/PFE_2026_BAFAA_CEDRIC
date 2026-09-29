import { apiJson, getApiBaseUrl, getAuthHeaders } from './api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  meta?: { aoCount: number; contextChars: number; estimatedTokens: number };
}

export type ChatMeta = { aoCount: number; contextChars: number; estimatedTokens: number };

/**
 * Réponse en streaming (SSE) : `onToken` est appelé pour chaque fragment reçu,
 * `onDone` avec les métadonnées à la fin. Annulable via `signal` (bouton Arrêter).
 */
export async function streamChatMessage(
  message: string,
  history: ChatMessage[],
  handlers: {
    onToken: (t: string) => void;
    onDone?: (meta: ChatMeta) => void;
    onError?: (m: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      message,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat stream ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const obj = JSON.parse(data) as
          | { type: 'token'; value: string }
          | { type: 'done'; meta: ChatMeta }
          | { type: 'error'; message: string };
        if (obj.type === 'token') handlers.onToken(obj.value);
        else if (obj.type === 'done') handlers.onDone?.(obj.meta);
        else if (obj.type === 'error') handlers.onError?.(obj.message);
      } catch {
        /* trame partielle — ignorée */
      }
    }
  }
}

export async function sendChatMessage(
  message: string,
  history: ChatMessage[],
): Promise<{ reply: string; meta: { aoCount: number; contextChars: number; estimatedTokens: number } }> {
  return apiJson<{ reply: string; meta: { aoCount: number; contextChars: number; estimatedTokens: number } }>('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
}
