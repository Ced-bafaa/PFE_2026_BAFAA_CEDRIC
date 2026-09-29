import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Send, Trash2, Sparkles, User, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { streamChatMessage, type ChatMessage } from "@/lib/chat-api";
import { toast } from "sonner";

// ── Suggestions initiales ────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Quels marchés sont recommandés GO en ce moment ?",
  "Montre-moi les AOs dont la deadline est cette semaine",
  "Quels marchés ont un budget supérieur à 50 millions FCFA ?",
  "Résume les points forts de nos meilleures opportunités",
  "Y a-t-il des marchés à Douala ou Yaoundé ?",
  "Quels AOs ont des critères bloquants identifiés ?",
];

// ── Rendu Markdown simplifié ─────────────────────────────────────────────────

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.indexOf("|", 1) > 0;
}
function isTableSeparator(line: string): boolean {
  return line.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Tableau Markdown (en-tête + ligne de séparation + lignes)
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      nodes.push(
        <div key={key++} className="overflow-x-auto my-2">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                {header.map((h, j) => (
                  <th key={j} className="border border-border px-2 py-1 text-left bg-muted/50 font-semibold">
                    {formatInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-border px-2 py-1 align-top">
                      {formatInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.trim() === "") {
      nodes.push(<div key={key++} className="h-2" />);
      i += 1;
      continue;
    }

    if (/^#{1,3}\s/.test(line)) {
      nodes.push(
        <p key={key++} className="font-semibold text-sm mt-2 mb-0.5">
          {formatInline(line.replace(/^#{1,3}\s/, ""))}
        </p>,
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s/.test(line)) {
      const indented = /^\s{2,}/.test(line);
      nodes.push(
        <div key={key++} className={`flex gap-2 text-sm leading-relaxed ${indented ? "ml-4" : ""}`}>
          <span className="text-primary mt-1 shrink-0">•</span>
          <span>{formatInline(line.replace(/^\s*[-*]\s/, ""))}</span>
        </div>,
      );
      i += 1;
      continue;
    }

    const numMatch = line.match(/^(\d+)\.\s(.+)/);
    if (numMatch) {
      nodes.push(
        <div key={key++} className="flex gap-2 text-sm leading-relaxed">
          <span className="text-muted-foreground shrink-0 w-4 text-right">{numMatch[1]}.</span>
          <span>{formatInline(numMatch[2])}</span>
        </div>,
      );
      i += 1;
      continue;
    }

    nodes.push(
      <p key={key++} className="text-sm leading-relaxed">
        {formatInline(line)}
      </p>,
    );
    i += 1;
  }

  return nodes;
}

/** Transforme les identifiants d'AO (armp-…) en liens vers la fiche. */
function linkifyAo(text: string): React.ReactNode[] {
  const parts = text.split(/(armp-[A-Za-z0-9._-]+)/g);
  return parts.map((p, i) =>
    /^armp-[A-Za-z0-9._-]+$/.test(p) ? (
      <Link key={i} to={`/opportunities/${p}`} className="text-primary hover:underline font-medium">
        {p}
      </Link>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{linkifyAo(part.slice(2, -2))}</strong>;
    }
    return <span key={i}>{linkifyAo(part)}</span>;
  });
}

// ── Composant bulle ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const time = msg.timestamp.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
    return (
      <div className="flex justify-end gap-2 items-end">
        <div className="max-w-[75%]">
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-right mt-1 pr-1">{time}</p>
        </div>
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mb-5">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-end">
      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mb-5">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="max-w-[80%]">
        <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm space-y-0.5">
          {renderMarkdown(msg.content)}
        </div>
        <div className="flex items-center gap-2 mt-1 pl-1">
          <p className="text-[10px] text-muted-foreground/50">{time}</p>
          {msg.meta && (
            <span className="text-[10px] text-muted-foreground/40 font-mono">
              {msg.meta.aoCount} AOs · ~{msg.meta.estimatedTokens} tokens
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Indicateur de frappe ─────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-2 items-end">
      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1.5 items-center h-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-primary/40 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Écran vide ────────────────────────────────────────────────────────────────

function EmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 py-12">
      {/* Icône centrale */}
      <div className="flex flex-col items-center gap-3">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center shadow-inner">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="font-semibold text-lg">Assistant KIAMA</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Posez vos questions sur les appels d'offres en base — je croise toutes les données pour vous répondre.
          </p>
        </div>
      </div>

      {/* Suggestions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="text-left px-4 py-3 rounded-xl border bg-card hover:bg-accent hover:border-primary/30 transition-colors text-sm text-muted-foreground hover:text-foreground group"
          >
            <span className="group-hover:text-primary mr-1.5">→</span>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll auto vers le bas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Redimensionnement auto du textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = { role: "user", content, timestamp: new Date() };
    const historyForCall = messages;
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);

    // Placeholder assistant rempli progressivement par le flux.
    const assistantMsg: ChatMessage = { role: "assistant", content: "", timestamp: new Date() };
    setMessages([...newHistory, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    try {
      await streamChatMessage(
        content,
        historyForCall,
        {
          onToken: (t) => {
            acc += t;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: acc };
              }
              return next;
            });
          },
          onDone: (meta) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: acc, meta };
              }
              return next;
            });
          },
          onError: (m) => {
            toast.error(m.slice(0, 140));
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Erreur : ${msg.slice(0, 120)}`);
      }
      // Si rien n'a été reçu, on retire la bulle assistant vide.
      if (!acc) setMessages(newHistory);
    } finally {
      abortRef.current = null;
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setInput("");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto w-full">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-sm leading-none">Assistant KIAMA</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">Groq · Llama 3.1</p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1.5 text-muted-foreground">
            <Trash2 className="h-3.5 w-3.5" />
            Effacer
          </Button>
        )}
      </div>

      {/* ── Zone messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <EmptyState onSuggest={(s) => handleSend(s)} />
        ) : (
          <>
            {messages.map((msg, i) => {
              // Bulle assistant vide en attente du premier token → indicateur de frappe.
              if (msg.role === "assistant" && msg.content === "" && loading && i === messages.length - 1) {
                return <TypingIndicator key={i} />;
              }
              return <MessageBubble key={i} msg={msg} />;
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Zone de saisie ── */}
      <div className="shrink-0 border-t bg-background/80 backdrop-blur px-4 py-3">
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Posez une question sur vos appels d'offres…"
              rows={1}
              disabled={loading}
              className="w-full resize-none rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50 transition-all min-h-[44px] max-h-40"
            />
            <p className="text-[10px] text-muted-foreground/40 absolute bottom-1 right-3">
              Entrée pour envoyer · Maj+Entrée pour saut de ligne
            </p>
          </div>
          {loading ? (
            <Button
              onClick={handleStop}
              size="icon"
              variant="secondary"
              className="h-11 w-11 rounded-xl shrink-0"
              title="Arrêter la génération"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              size="icon"
              className="h-11 w-11 rounded-xl shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
