'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isTextUIPart, type UIMessage } from 'ai';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/contexts/AuthContext';
import { Bot, Loader2, Send, Sparkles, User } from 'lucide-react';
import { ChatSidebar } from './ChatSidebar';

interface AICopilotViewProps {
  storeId: string;
  storeName: string;
}

interface ChatSessionProps {
  chatId: string;
  storeId: string;
  storeName: string;
  userId?: string;
  initialMessages: UIMessage[];
  onChatUpdated: () => void;
}

function createChatId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('');
}

const ChatSession: React.FC<ChatSessionProps> = ({
  chatId,
  storeId,
  storeName,
  userId,
  initialMessages,
  onChatUpdated,
}) => {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followConversationRef = useRef(false);
  const [input, setInput] = useState('');

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: {
          storeId,
          userId,
        },
      }),
    [storeId, userId]
  );

  const { messages, sendMessage, status, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!followConversationRef.current) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      followConversationRef.current = false;
    }
  }, [isLoading]);

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault?.();
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    followConversationRef.current = true;
    await sendMessage({ text });
    onChatUpdated();

    if (window.matchMedia('(max-width: 767px)').matches) {
      inputRef.current?.blur();
    } else {
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="card-elevated flex flex-col h-[70vh] md:h-[calc(100vh-16rem)] min-h-[420px] md:min-h-[480px] overflow-hidden">
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 sm:p-6 space-y-4 scrollbar-hide select-text"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-brand-600 dark:text-brand-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Vítejte v AI asistentovi
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
              Zeptejte se na cokoli ohledně prodeje, dokladů nebo práce s pokladnou v prodejně {storeName}.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === 'user';
            const text = getMessageText(message);

            if (!text) return null;

            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center mt-1">
                    <Bot className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 select-text ${
                    isUser
                      ? 'bg-brand-600 text-white rounded-br-md'
                      : 'bg-gray-100 dark:bg-gray-700/80 text-gray-900 dark:text-gray-100 rounded-bl-md'
                  }`}
                >
                  <div className="text-sm leading-relaxed break-words select-text">
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{text}</p>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ node, ...props }) => (
                            <div className="overflow-x-auto my-4 rounded-lg border border-slate-700">
                              <table
                                className="min-w-full divide-y divide-slate-700 text-left text-sm text-slate-200"
                                {...props}
                              />
                            </div>
                          ),
                          thead: ({ node, ...props }) => (
                            <thead className="bg-slate-800 text-xs uppercase text-slate-400" {...props} />
                          ),
                          th: ({ node, ...props }) => (
                            <th className="px-4 py-3 font-semibold" {...props} />
                          ),
                          tbody: ({ node, ...props }) => (
                            <tbody className="divide-y divide-slate-800" {...props} />
                          ),
                          td: ({ node, ...props }) => (
                            <td className="px-4 py-3 whitespace-nowrap" {...props} />
                          ),
                          ul: ({ node, ...props }) => (
                            <ul className="my-2 list-disc list-inside space-y-1" {...props} />
                          ),
                          ol: ({ node, ...props }) => (
                            <ol className="my-2 list-decimal list-inside space-y-1" {...props} />
                          ),
                          li: ({ node, ...props }) => (
                            <li className="leading-relaxed" {...props} />
                          ),
                          strong: ({ node, ...props }) => (
                            <strong className="font-semibold text-gray-900 dark:text-white" {...props} />
                          ),
                          p: ({ node, ...props }) => (
                            <p className="my-1.5 leading-relaxed" {...props} />
                          ),
                        }}
                      >
                        {text}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>

                {isUser && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center mt-1">
                    <User className="h-4 w-4 text-white" />
                  </div>
                )}
              </motion.div>
            );
          })
        )}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center">
              <Bot className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            </div>
            <div className="bg-gray-100 dark:bg-gray-700/80 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Přemýšlím…
              </div>
            </div>
          </div>
        )}

      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mb-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error.message || 'Nepodařilo se odeslat zprávu. Zkuste to prosím znovu.'}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="glass-panel border-t border-gray-200/60 dark:border-gray-700/60 rounded-t-none rounded-b-xl p-4 sm:p-5"
      >
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Napište zprávu..."
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-60 select-text min-h-[48px] max-h-32"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex-shrink-0 w-12 h-12 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white flex items-center justify-center transition-colors"
            aria-label="Odeslat zprávu"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </form>
    </div>
  );
};

export const AICopilotView: React.FC<AICopilotViewProps> = ({ storeId, storeName }) => {
  const { user } = useAuth();
  const [chatId, setChatId] = useState(createChatId);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleNewChat = () => {
    setLoadError(null);
    setChatId(createChatId());
    setInitialMessages([]);
  };

  const handleSelectChat = async (selectedChatId: string) => {
    if (!user?.uid || selectedChatId === chatId) return;

    setLoadingChat(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({ userId: user.uid });
      const response = await fetch(`/api/chats/${selectedChatId}?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Nepodařilo se načíst vybraný chat.');
      }

      const data = (await response.json()) as { messages?: UIMessage[] };
      setInitialMessages(data.messages ?? []);
      setChatId(selectedChatId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Nepodařilo se načíst vybraný chat.');
    } finally {
      setLoadingChat(false);
    }
  };

  const handleChatUpdated = () => {
    setSidebarRefreshKey((current) => current + 1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-brand-600" />
          AI Chat
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Asistent pro prodejnu {storeName}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="order-1 md:order-2 flex-1 min-w-0">
          {loadError && (
            <div className="mb-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {loadError}
            </div>
          )}

          {loadingChat ? (
            <div className="card-elevated flex items-center justify-center h-[70vh] md:h-[calc(100vh-16rem)] min-h-[420px] md:min-h-[480px]">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                Načítám chat…
              </div>
            </div>
          ) : (
            <ChatSession
              key={chatId}
              chatId={chatId}
              storeId={storeId}
              storeName={storeName}
              userId={user?.uid}
              initialMessages={initialMessages}
              onChatUpdated={handleChatUpdated}
            />
          )}
        </div>

        <div className="order-2 md:order-1">
          <ChatSidebar
            userId={user?.uid}
            storeId={storeId}
            activeChatId={chatId}
            refreshKey={sidebarRefreshKey}
            onSelectChat={(selectedChatId) => void handleSelectChat(selectedChatId)}
            onNewChat={handleNewChat}
          />
        </div>
      </div>
    </div>
  );
};
