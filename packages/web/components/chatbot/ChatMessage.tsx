"use client";

interface Source {
  type: string;
  section_path?: string;
  page_start?: number;
  text?: string;
  tier?: Record<string, unknown>;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  groundednessScore?: number;
  onFeedback?: (positive: boolean) => void;
}

export default function ChatMessage({
  role,
  content,
  sources,
  onFeedback,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-800 border border-gray-200"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>

        {!isUser && sources && sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-300">
            <p className="text-xs font-semibold text-gray-500 mb-1">Sources:</p>
            <div className="flex flex-col gap-1">
              {sources.map((src, idx) => {
                const label =
                  src.type === "matrix"
                    ? `Matrix${src.page_start != null ? ` p.${src.page_start}` : ""}`
                    : src.section_path
                    ? `${src.section_path}${src.page_start != null ? ` p.${src.page_start}` : ""}`
                    : `Section${src.page_start != null ? ` p.${src.page_start}` : ""}`;
                return (
                  <button
                    key={idx}
                    className="text-left text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title={src.text ?? label}
                  >
                    [{idx + 1}] {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isUser && onFeedback && (
          <div className="mt-2 flex gap-2 justify-end">
            <button
              onClick={() => onFeedback(true)}
              className="text-gray-400 hover:text-green-600 text-base leading-none transition-colors"
              title="Helpful"
            >
              +
            </button>
            <button
              onClick={() => onFeedback(false)}
              className="text-gray-400 hover:text-red-600 text-base leading-none transition-colors"
              title="Not helpful"
            >
              -
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
