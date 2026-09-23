import { useEffect, useRef, useState } from "react";
import { ChatOutlined, CloseOutlined, SendOutlined } from "@mui/icons-material";

interface ChatMessage {
  id: number;
  role: "ai" | "user";
  text: string;
}

interface TripAssistantProps {
  city: string;
}

const INTRO_MESSAGE =
  "Ask me anything about your trip — rain plans, cheaper days, shorter walks.";

const SUGGESTIONS = ["Plan for rain", "Make it cheaper", "Less Walking"];

export default function TripAssistant({ city }: TripAssistantProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: "ai", text: INTRO_MESSAGE },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyCountRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    return () => {
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
    };
  }, []);

  const buildReply = (): string => {
    replyCountRef.current += 1;
    return (
      `Sure — here's what I'd change for ${city}. ` +
      `A warm layering approach works best: keep the mornings flexible, plan the longer outdoor stops for the driest window, and move the coffee-and-culture pick into the afternoon. ` +
      `For budget, swapping one meal for a market snack saves roughly €15, and the walking route I'd suggest cuts about 20 minutes while still hitting the two landmarks you liked. ` +
      `If the weather turns, all three indoor options are within a short walk, so the day still flows without backtracking. ` +
      `Want me to reorder the day around a rain-safe version, or would you prefer a lighter-pace alternative? ` +
      `I can also drop a shorter route that keeps the same stops and trims the transit between them. ` +
      `Just tell me which one sounds better and I'll lay out the exact schedule with times and costs, ` +
      `including where to grab a quick lunch on the move. ` +
      `And if you ever want the whole thing rebalanced, I can fold in your pace and walking preferences automatically ` +
      `(reply №${replyCountRef.current}, ${city} trip).`
    );
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    setMessages((current) => [
      ...current.filter((message) => message.id !== 0),
      { id: Date.now(), role: "user", text: trimmed },
    ]);
    setInput("");
    setTyping(true);
    replyTimerRef.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: Date.now(), role: "ai", text: buildReply() },
      ]);
      setTyping(false);
    }, 900);
  };

  return (
    <>
      <button
        type="button"
        className="assistant-fab"
        onClick={() => setOpen(true)}
        aria-label="Ask Triply"
      >
        <ChatOutlined />
        <span className="assistant-fab-label">Ask Triply</span>
      </button>

      {open && (
        <>
          <div className="assistant-overlay" onClick={() => setOpen(false)} />
          <aside className="assistant-panel" aria-label={`Ask Triply about ${city}`}>
            <div className="assistant-top">
              <h2 className="assistant-title">Ask Triply about {city} Trip</h2>
              <button
                type="button"
                className="assistant-close"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
                <CloseOutlined />
              </button>
            </div>

            <div className="assistant-chat" ref={chatRef}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`assistant-bubble is-${message.role}${
                    message.id === 0 ? " is-intro" : ""
                  }`}
                >
                  {message.text}
                </div>
              ))}
              {typing && (
                <div className="assistant-bubble is-ai">
                  <span className="assistant-typing" />
                </div>
              )}
            </div>

            <div className="assistant-composer">
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="assistant-suggestion"
                    onClick={() => send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <div className="assistant-divider" />
              <div className="assistant-input-row">
                <input
                  className="assistant-input"
                  value={input}
                  placeholder="It will rain tomorrow. What we should change?"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") send(input);
                  }}
                />
                <button
                  type="button"
                  className="assistant-send"
                  onClick={() => send(input)}
                  disabled={!input.trim() || typing}
                  aria-label="Send message"
                >
                  <SendOutlined />
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}