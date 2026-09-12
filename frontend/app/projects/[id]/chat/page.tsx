"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useParams } from "next/navigation";

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
      parts.push(<strong key={idx++} style={{ fontWeight: 700, color: "#fff" }}>{m[2]}</strong>);
    } else if (m[0].startsWith("`")) {
      parts.push(
        <code key={idx++} style={{ background: "rgba(133,166,233,0.14)", color: "#85A6E9", padding: "1px 6px", borderRadius: 4, fontSize: "0.85em", fontFamily: "monospace" }}>
          {m[3]}
        </code>
      );
    } else if (m[0].startsWith("[")) {
      parts.push(
        <a key={idx++} href={m[5]} target="_blank" rel="noopener noreferrer"
          style={{ color: "#85A6E9", textDecoration: "underline", textUnderlineOffset: 2 }}>
          {m[4]}
        </a>
      );
    } else {
      parts.push(<em key={idx++} style={{ color: "#C7CBDA" }}>{m[6]}</em>);
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
        <pre key={`code-${i}`} style={{ background: "rgba(10,14,23,0.65)", border: "1px solid rgba(133,166,233,0.12)", borderRadius: 10, padding: "12px 14px", fontSize: 12, fontFamily: "monospace", overflow: "auto", margin: "10px 0", color: "#C7CBDA", whiteSpace: "pre", lineHeight: 1.5 }}>
          {codeLines.join("\n")}
        </pre>
      );
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} style={{ fontWeight: 700, color: "#85A6E9", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", margin: "14px 0 3px" }}>{parseInline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} style={{ fontWeight: 700, color: "#fff", fontSize: 14.5, margin: "18px 0 6px" }}>{parseInline(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} style={{ fontWeight: 800, color: "#fff", fontSize: 16, margin: "18px 0 8px" }}>{parseInline(line.slice(2))}</h1>);
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ paddingLeft: 18, margin: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 13, lineHeight: 1.6, color: "#ABAEBB" }}>{parseInline(item)}</li>
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
        <ol key={`ol-${i}`} style={{ paddingLeft: 18, margin: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 13, lineHeight: 1.6, color: "#ABAEBB" }}>{parseInline(item)}</li>
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
        <blockquote key={`bq-${i}`} style={{ borderLeft: "3px solid rgba(133,166,233,0.4)", paddingLeft: 12, margin: "8px 0", color: "#8B92A8", fontStyle: "italic", fontSize: 13, lineHeight: 1.6 }}>
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
        <div key={`table-${i}`} style={{ overflowX: "auto", margin: "10px 0", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr>
                {header.map((h, j) => (
                  <th key={j} style={{ textAlign: "left", padding: "8px 12px", color: "#85A6E9", fontWeight: 700, background: "rgba(133,166,233,0.08)", borderBottom: "1px solid rgba(133,166,233,0.15)", whiteSpace: "nowrap" }}>
                    {parseInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} style={{ borderTop: j > 0 ? "1px solid rgba(133,166,233,0.08)" : undefined }}>
                  {row.map((cell, k) => (
                    <td key={k} style={{ padding: "8px 12px", color: "#ABAEBB" }}>{parseInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(133,166,233,0.15)", margin: "10px 0" }} />);
    } else if (line.trim() === "") {
      elements.push(<div key={`sp-${i}`} style={{ height: 6 }} />);
    } else {
      elements.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.6, color: "#ABAEBB", margin: 0 }}>{parseInline(line)}</p>);
    }

    i++;
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{elements}</div>;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", gap: 12, flexDirection: isUser ? "row-reverse" : "row" }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, marginTop: 2,
        background: isUser ? "#85A6E9" : "rgba(133,166,233,0.12)",
        color: isUser ? "#0E111B" : "#85A6E9",
        border: isUser ? "none" : "1px solid rgba(133,166,233,0.2)",
      }}>
        {isUser ? "Du" : "KI"}
      </div>

      <div style={{
        maxWidth: "80%", borderRadius: 16, padding: "11px 15px",
        ...(isUser
          ? { background: "#85A6E9", color: "#0E111B", borderTopRightRadius: 4, boxShadow: "0 2px 10px rgba(133,166,233,0.3)" }
          : { background: "rgba(23,37,64,0.7)", border: "1px solid rgba(133,166,233,0.15)", borderTopLeftRadius: 4, boxShadow: "0 2px 10px rgba(0,0,0,0.2)" }
        ),
      }}>
        {msg.streaming && msg.content === "" && (
          <div style={{ display: "flex", gap: 4, padding: "2px 0" }}>
            <span className="animate-bounce" style={{ width: 6, height: 6, background: "#7B8299", borderRadius: "50%", animationDelay: "0ms" }} />
            <span className="animate-bounce" style={{ width: 6, height: 6, background: "#7B8299", borderRadius: "50%", animationDelay: "150ms" }} />
            <span className="animate-bounce" style={{ width: 6, height: 6, background: "#7B8299", borderRadius: "50%", animationDelay: "300ms" }} />
          </div>
        )}

        {msg.content !== "" && (
          isUser
            ? <span style={{ fontSize: 13, lineHeight: 1.6, color: "#0E111B", whiteSpace: "pre-wrap" }}>{msg.content}</span>
            : <MarkdownContent text={msg.content} />
        )}

        {msg.streaming && msg.content !== "" && (
          <span className="animate-pulse" style={{ display: "inline-block", width: 2, height: 14, background: "#7B8299", marginLeft: 2, verticalAlign: "middle" }} />
        )}
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
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", transition: "background .15s",
        background: active ? "rgba(40,98,215,0.15)" : "none",
        color: active ? "#85A6E9" : "#7B8299",
      }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.06)"; (e.currentTarget as HTMLElement).style.color = "#ABAEBB"; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "#7B8299"; } }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>
        {thread.preview || "Neue Konversation"}
      </div>
      <div style={{ fontSize: 10, color: "#4B5268", marginTop: 2 }}>
        {formatThreadDate(thread.started_at)}
      </div>
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
    <div style={{ display: "flex", height: "calc(100vh - 8rem)", background: "rgba(14,17,27,0.7)", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 16, overflow: "hidden" }}>

      {/* Thread sidebar */}
      <div style={{ width: 200, flexShrink: 0, borderRight: "1px solid rgba(133,166,233,0.1)", display: "flex", flexDirection: "column", background: "rgba(10,14,23,0.5)" }}>
        <div style={{ padding: 12, borderBottom: "1px solid rgba(133,166,233,0.1)" }}>
          <button
            onClick={startNewChat}
            disabled={streaming}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 8, background: "none", border: "1px solid rgba(133,166,233,0.2)", fontSize: 12, fontWeight: 500, color: "#7B8299", cursor: streaming ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: streaming ? 0.4 : 1, transition: "all .15s" }}
            onMouseEnter={e => { if (!streaming) { (e.currentTarget as HTMLElement).style.borderColor = "#85A6E9"; (e.currentTarget as HTMLElement).style.color = "#85A6E9"; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(133,166,233,0.2)"; (e.currentTarget as HTMLElement).style.color = "#7B8299"; }}
          >
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Neuer Chat
          </button>
        </div>

        <div className="scrollbar-dark" style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {threadsLoading ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 24 }}>
              <div className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(133,166,233,0.15)", borderTopColor: "#85A6E9", borderRadius: "50%" }} />
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
                <p style={{ fontSize: 10, color: "#4B5268", textAlign: "center", padding: "24px 8px" }}>Noch keine Chats</p>
              )}
              {threads.map(t => (
                <ThreadItem key={t.id} thread={t} active={activeThreadId === t.id} onClick={() => selectThread(t.id)} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Disclaimer */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: "rgba(251,191,36,0.06)", borderBottom: "1px solid rgba(251,191,36,0.15)", flexShrink: 0 }}>
          <svg style={{ width: 16, height: 16, color: "#FBBF24", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p style={{ fontSize: 12, color: "#FBBF24", margin: 0, opacity: 0.8 }}>
            Dieser Chat ersetzt keine Rechtsberatung. Aussagen des Assistenten sind nicht rechtsverbindlich.
          </p>
        </div>

        {/* Messages */}
        <div className="scrollbar-dark" style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {messagesLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <div className="animate-spin" style={{ width: 24, height: 24, border: "2px solid rgba(133,166,233,0.15)", borderTopColor: "#85A6E9", borderRadius: "50%" }} />
            </div>
          ) : messages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, textAlign: "center" }}>
              <div style={{ width: 48, height: 48, background: "rgba(133,166,233,0.12)", border: "1px solid rgba(133,166,233,0.2)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg style={{ width: 24, height: 24, color: "#85A6E9" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#ABAEBB", margin: 0 }}>Stell eine Frage</p>
                <p style={{ fontSize: 12, color: "#7B8299", margin: "4px 0 0" }}>Zum Projekt, zu Normen oder zu Schweizer Baurecht.</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 }}>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                    style={{ fontSize: 12, color: "#7B8299", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 100, padding: "6px 14px", background: "none", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#85A6E9"; (e.currentTarget as HTMLElement).style.color = "#85A6E9"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(133,166,233,0.15)"; (e.currentTarget as HTMLElement).style.color = "#7B8299"; }}
                  >
                    {s}
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
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px" }}>
              <svg style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ flexShrink: 0, borderTop: "1px solid rgba(133,166,233,0.1)", padding: "12px 16px", background: "rgba(10,14,23,0.4)" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: "rgba(23,37,64,0.6)", borderRadius: 16, padding: "8px 14px", border: "1px solid rgba(133,166,233,0.15)", transition: "border-color .15s" }}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Frage stellen... (Enter zum Senden, Shift+Enter für neue Zeile)"
              disabled={streaming}
              style={{ flex: 1, resize: "none", background: "transparent", fontSize: 13, color: "#fff", border: "none", outline: "none", lineHeight: 1.6, opacity: streaming ? 0.5 : 1, minHeight: 22, fontFamily: "inherit" }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              style={{ flexShrink: 0, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "#2862D7", color: "#fff", border: "none", cursor: !input.trim() || streaming ? "not-allowed" : "pointer", opacity: !input.trim() || streaming ? 0.4 : 1, transition: "all .15s" }}
              title="Senden"
            >
              {streaming ? (
                <svg className="animate-spin" style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none">
                  <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
          </div>
          <p style={{ fontSize: 10, color: "#4B5268", textAlign: "center", margin: "6px 0 0" }}>
            Powered by Claude Haiku · Nicht rechtsverbindlich
          </p>
        </div>

      </div>
    </div>
  );
}
