"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useParams } from "next/navigation";
import p from "@/app/projects/project.module.css";
import ProjectBanner from "@/components/project/ProjectBanner";
import s from "./chat.module.css";

interface Thread {
  id: string;
  preview: string;
  started_at: string;
}

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  streaming?: boolean;
}

function parseInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*(.+?)\*)/g;
  let last = 0;
  let idx  = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[0].startsWith("**")) {
      parts.push(<strong key={idx++} style={{ fontWeight: 700, color: "var(--ink)" }}>{m[2]}</strong>);
    } else if (m[0].startsWith("`")) {
      parts.push(
        <code key={idx++} style={{ background: "rgba(203,191,174,0.32)", color: "#3d372e", padding: "1px 6px", borderRadius: 6, fontSize: "0.88em", fontFamily: "monospace" }}>
          {m[3]}
        </code>
      );
    } else if (m[0].startsWith("[")) {
      parts.push(
        <a key={idx++} href={m[5]} target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--info-text)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}>
          {m[4]}
        </a>
      );
    } else {
      parts.push(<em key={idx++} style={{ color: "var(--body)" }}>{m[6]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

function MarkdownContent({ text }: { text: string }) {
  const lines    = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} style={{ background: "#151414", borderRadius: 12, padding: "12px 14px", fontSize: 14, fontFamily: "monospace", overflow: "auto", margin: "10px 0", color: "#f1ece3", whiteSpace: "pre", lineHeight: 1.5 }}>
          {codeLines.join("\n")}
        </pre>
      );
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} style={{ fontWeight: 800, color: "var(--bronze-deep)", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", margin: "14px 0 3px" }}>{parseInline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} style={{ fontWeight: 700, color: "var(--ink)", fontSize: 17, margin: "18px 0 6px" }}>{parseInline(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h3 key={i} style={{ fontWeight: 800, color: "var(--ink)", fontSize: 18, margin: "18px 0 8px" }}>{parseInline(line.slice(2))}</h3>);
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ listStyle: "disc", paddingLeft: 22, margin: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 16, lineHeight: 1.65, color: "var(--body)" }}>{parseInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ listStyle: "decimal", paddingLeft: 22, margin: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 16, lineHeight: 1.65, color: "var(--body)" }}>{parseInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    } else if (/^> /.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^> ?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^> ?/, ""));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${i}`} style={{ borderLeft: "3px solid #b5a893", background: "#f6f3ee", borderRadius: 8, padding: "8px 12px", margin: "8px 0", color: "var(--body)", fontStyle: "italic", fontSize: 16, lineHeight: 1.65 }}>
          {quoteLines.map((q, j) => <div key={j}>{parseInline(q)}</div>)}
        </blockquote>
      );
      continue;
    } else if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      elements.push(
        <div key={`table-${i}`} style={{ overflowX: "auto", margin: "10px 0", boxShadow: "inset 0 0 0 1px rgba(21,20,20,0.18)", borderRadius: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 15 }}>
            <thead>
              <tr>
                {header.map((h, j) => (
                  <th key={j} style={{ textAlign: "left", padding: "8px 12px", color: "var(--ink)", fontWeight: 800, background: "rgba(203,191,174,0.3)", borderBottom: "1px solid rgba(21,20,20,0.18)", whiteSpace: "nowrap" }}>
                    {parseInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} style={{ borderTop: j > 0 ? "1px solid var(--line)" : undefined }}>
                  {row.map((cell, k) => (
                    <td key={k} style={{ padding: "8px 12px", color: "var(--body)" }}>{parseInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--line)", margin: "10px 0" }} />);
    } else if (line.trim() === "") {
      elements.push(<div key={`sp-${i}`} style={{ height: 6 }} />);
    } else {
      elements.push(<p key={i} style={{ fontSize: 16, lineHeight: 1.65, color: "var(--body)", margin: 0 }}>{parseInline(line)}</p>);
    }

    i++;
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{elements}</div>;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`${s.msg} ${isUser ? s.msgUser : ""}`}>
      <div className={`${s.avatar} ${isUser ? s.avatarUser : s.avatarBot}`} aria-hidden="true">
        {isUser ? "Du" : "KI"}
      </div>

      <div className={`${s.bubble} ${isUser ? s.bubbleUser : `${p.glassFlat} ${s.bubbleBot}`}`}>
        {msg.streaming && msg.content === "" && (
          <div className={s.dots} role="status" aria-label="Antwort wird erstellt">
            <span className={s.dot} style={{ animationDelay: "0ms" }} />
            <span className={s.dot} style={{ animationDelay: "150ms" }} />
            <span className={s.dot} style={{ animationDelay: "300ms" }} />
          </div>
        )}

        {msg.content !== "" && (
          isUser
            ? <span className={s.userText}>{msg.content}</span>
            : <MarkdownContent text={msg.content} />
        )}

        {msg.streaming && msg.content !== "" && <span className={s.cursor} />}
      </div>
    </div>
  );
}

function formatThreadDate(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "heute";
  if (diff === 1) return "gestern";
  return d.toLocaleDateString("de-CH", { day: "numeric", month: "short" });
}

function ThreadItem({ thread, active, onClick }: { thread: Thread; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`${s.thread} ${active ? s.threadActive : ""}`}
    >
      <span className={s.threadTitle}>{thread.preview || "Neue Konversation"}</span>
      <span className={s.threadDate}>{formatThreadDate(thread.started_at)}</span>
    </button>
  );
}

const SUGGESTIONS = [
  "Was sind die Hauptverstösse aus der letzten Analyse?",
  "Welche Normen gelten für dieses Projekt?",
  "Was ist der Grenzabstand in dieser Bauzone?",
];

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();

  const [threads, setThreads]                 = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId]   = useState<string>("");
  const [threadsLoading, setThreadsLoading]   = useState(true);

  const [messages, setMessages]               = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [input, setInput]       = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError]       = useState("");

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setThreadsLoading(true);
      setMessages([]);
      try {
        const res  = await fetch(`/api/v1/projects/${id}/chat/threads`);
        const json = await res.json() as { data: Thread[] | null };
        if (cancelled) return;

        const list = json.data ?? [];
        setThreads(list);

        if (list.length > 0) {
          const tid = list[0].id;
          setActiveThreadId(tid);
          setMessagesLoading(true);
          const mRes  = await fetch(`/api/v1/projects/${id}/chat?thread=${tid}`);
          const mJson = await mRes.json() as { data: ChatMessage[] | null };
          if (!cancelled) {
            if (mJson.data) setMessages(mJson.data);
            setMessagesLoading(false);
          }
        } else {
          setActiveThreadId(crypto.randomUUID());
        }
      } finally {
        if (!cancelled) setThreadsLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function selectThread(threadId: string) {
    if (activeThreadId === threadId || streaming) return;
    setActiveThreadId(threadId);
    setMessages([]);
    setError("");
    setMessagesLoading(true);
    try {
      const res  = await fetch(`/api/v1/projects/${id}/chat?thread=${threadId}`);
      const json = await res.json() as { data: ChatMessage[] | null };
      if (json.data) setMessages(json.data);
    } finally {
      setMessagesLoading(false);
    }
  }

  function startNewChat() {
    if (streaming) return;
    setActiveThreadId(crypto.randomUUID());
    setMessages([]);
    setError("");
    textareaRef.current?.focus();
  }

  async function refreshThreadList() {
    try {
      const res  = await fetch(`/api/v1/projects/${id}/chat/threads`);
      const json = await res.json() as { data: Thread[] | null };
      if (json.data) setThreads(json.data);
    } catch { /* silent */ }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming || !activeThreadId) return;

    setInput("");
    setError("");
    if (textareaRef.current) textareaRef.current.style.height = "22px";

    setMessages(prev => [
      ...prev,
      { role: "user",      content: text },
      { role: "assistant", content: "", streaming: true },
    ]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/v1/projects/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, thread_id: activeThreadId }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`Fehler ${res.status}${body ? `: ${body}` : ""}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = part.slice(6);

          if (data === "[DONE]") break outer;
          if (data.startsWith("[ERROR]")) { setError(data.slice(8)); break outer; }

          try {
            const token: string = JSON.parse(data);
            setMessages(prev => {
              const updated = [...prev];
              const last    = updated[updated.length - 1];
              if (last?.streaming) {
                updated[updated.length - 1] = { ...last, content: last.content + token };
              }
              return updated;
            });
          } catch { /* ignore malformed chunk */ }
        }
      }

      refreshThreadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setMessages(prev => {
        const updated = [...prev];
        const last    = updated[updated.length - 1];
        if (last?.streaming) {
          if (last.content === "") {
            updated.pop();
          } else {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
        }
        return updated;
      });
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }

  const isNewThread = !threads.some(t => t.id === activeThreadId);

  return (
    <>
      <ProjectBanner
        variant="chat"
        title="KI Chat"
        subtitle={threadsLoading ? undefined : threads.length === 1 ? "1 Konversation" : `${threads.length} Konversationen`}
        actions={
          <button type="button" onClick={startNewChat} disabled={streaming} className={p.btnSand}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Neuer Chat
          </button>
        }
      />

      <div className={`${p.glassFlat} ${s.layout}`}>
        <aside className={s.side} aria-label="Konversationen">
          <div className={s.sideHead}>
            <h2 className={p.sectionTitle}>Verlauf</h2>
          </div>

          <div className={s.threadList}>
            {threadsLoading ? (
              <div className={s.sideLoading}>
                <span className={`${s.spinner} ${s.spinnerSm}`} role="status" aria-label="Konversationen werden geladen" />
              </div>
            ) : (
              <>
                {isNewThread && (
                  <ThreadItem
                    thread={{ id: activeThreadId, preview: "Neue Konversation", started_at: new Date().toISOString() }}
                    active={true}
                    onClick={() => {}}
                  />
                )}
                {threads.length === 0 && !isNewThread && (
                  <p className={s.sideEmpty}>Noch keine Chats</p>
                )}
                {threads.map(t => (
                  <ThreadItem key={t.id} thread={t} active={activeThreadId === t.id} onClick={() => selectThread(t.id)} />
                ))}
              </>
            )}
          </div>
        </aside>

        <div className={s.main}>
          <div className={s.disclaimer}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p>Dieser Chat ersetzt keine Rechtsberatung. Aussagen des Assistenten sind nicht rechtsverbindlich.</p>
          </div>

          <div className={s.messages}>
            {messagesLoading ? (
              <div className={s.center}>
                <span className={s.spinner} role="status" aria-label="Nachrichten werden geladen" />
              </div>
            ) : messages.length === 0 ? (
              <div className={s.center}>
                <div className={p.iconTile}>
                  <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </div>
                <div>
                  <p className={s.emptyTitle}>Stell eine Frage</p>
                  <p className={s.emptySub}>Zum Projekt, zu Normen oder zu Schweizer Baurecht.</p>
                </div>
                <div className={s.suggestions}>
                  {SUGGESTIONS.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                      className={`${p.pill} ${s.suggestion}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <MessageBubble key={msg.id ?? i} msg={msg} />
              ))
            )}

            {error && (
              <div className={s.error} role="alert">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className={s.composer}>
            <div className={s.field}>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Frage stellen... (Enter zum Senden, Shift+Enter für neue Zeile)"
                aria-label="Nachricht an den Assistenten"
                disabled={streaming}
                className={s.textarea}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                className={`${p.btnNavy} ${s.send}`}
                title="Senden"
                aria-label="Senden"
              >
                {streaming ? (
                  <svg className={s.spin} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path style={{ opacity: 0.85 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                )}
              </button>
            </div>
            <p className={s.footnote}>Powered by Claude Haiku · Nicht rechtsverbindlich</p>
          </div>
        </div>
      </div>
    </>
  );
}
