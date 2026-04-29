"use client";
import { useState, useRef, useEffect } from "react";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";

interface Source {
  type: string;
  section_path?: string;
  page_start?: number;
  text?: string;
  tier?: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  groundednessScore?: number;
}

interface ChatPanelProps {
  tenantId: string;
  loanId?: string;
  loanContext?: {
    program?: string;
    fico?: number;
    ltv?: number;
    occupancy?: string;
  };
}

const INITIAL_SUGGESTIONS = [
  "Max LTV for DSCR?",
  "Min FICO requirements",
  "Cash-out allowed?",
];

export default function ChatPanel({
  tenantId,
  loanId,
  loanContext,
}: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(INITIAL_SUGGESTIONS);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const handleSend = async (query: string) => {
    const userMsg: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    setSuggestions([]);
    setIsLoading(true);

    try {
      const resp = await fetch("/api/guidelines/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          conversationId,
          query,
          loanContext,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data?.error ?? `Request failed (${resp.status})`);
      }

      if (data.conversation_id && !conversationId) {
        setConversationId(data.conversation_id);
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: data.answer ?? data.message ?? "No response received.",
        sources: data.sources ?? [],
        groundednessScore: data.groundedness_score,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (Array.isArray(data.follow_up_suggestions) && data.follow_up_suggestions.length > 0) {
        setSuggestions(data.follow_up_suggestions);
      }
    } catch (err) {
      const errorMsg: Message = {
        role: "assistant",
        content:
          err instanceof Error
            ? `Error: ${err.message}`
            : "An unexpected error occurred. Please try again.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-lg flex items-center justify-center text-white hover:bg-blue-700 transition-colors z-50"
        title="Guideline Assistant"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-7 h-7"
        >
          <path
            fillRule="evenodd"
            d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.155L8.12 21.53A.75.75 0 017 21v-3.545a48.842 48.842 0 01-2.152-.309c-1.978-.292-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 w-[380px] h-[600px] bg-white border-l border-t border-gray-200 shadow-2xl flex flex-col rounded-tl-xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 rounded-tl-xl">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Guideline Assistant
          </h2>
          {loanId && (
            <p className="text-xs text-gray-500 mt-0.5">Loan {loanId}</p>
          )}
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-gray-600 transition-colors p-1"
          title="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      {/* Disclaimer */}
      <div className="px-3 py-2 bg-amber-50 border-b border-amber-100">
        <p className="text-xs text-amber-800">
          Guideline summary — verify with source documents before final credit decisions.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 text-center px-6">
              Ask about loan program guidelines, LTV limits, FICO requirements, and more.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <ChatMessage
            key={idx}
            role={msg.role}
            content={msg.content}
            sources={msg.sources}
            groundednessScore={msg.groundednessScore}
          />
        ))}

        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-100 text-gray-500 border border-gray-200 rounded-lg px-3 py-2 text-sm">
              Searching guidelines...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        suggestions={suggestions}
      />
    </div>
  );
}
