'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isTextUIPart, type UIMessage } from 'ai';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Bot, Loader2, Send, Sparkles, User } from 'lucide-react';

interface AICopilotViewProps {
  storeId: string;
  storeName: string;
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('');
}

export const AICopilotView: React.FC<AICopilotViewProps> = ({ storeId, storeName }) => {
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: {
          storeId,
          userId: user?.uid,
        },
      }),
    [storeId, user?.uid]
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault?.();
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    await sendMessage({ text });
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-purple-600" />
            AI Chat
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Asistent pro prodejnu {storeName}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 card-elevated px-3 py-2">
          <Bot className="h-4 w-4 text-purple-500" />
          Claude 3.5 Sonnet
        </div>
      </div>

      <div className="card-elevated flex flex-col h-[calc(100vh-16rem)] min-h-[480px] overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-4">
                <Sparkles className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Vítejte v AI asistentovi
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
                Zeptejte se na cokoli ohledně prodeje, dokladů nebo práce s pokladnou. Asistent je zatím v testovacím režimu.
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
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mt-1">
                      <Bot className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 select-text ${
                      isUser
                        ? 'bg-purple-600 text-white rounded-br-md'
                        : 'bg-gray-100 dark:bg-gray-700/80 text-gray-900 dark:text-gray-100 rounded-bl-md'
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{text}</p>
                  </div>

                  {isUser && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center mt-1">
                      <User className="h-4 w-4 text-white" />
                    </div>
                  )}
                </motion.div>
              );
            })
          )}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                <Bot className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="bg-gray-100 dark:bg-gray-700/80 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Přemýšlím…
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
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
              placeholder="Napište zprávu… (Enter pro odeslání, Shift+Enter pro nový řádek)"
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-60 select-text min-h-[48px] max-h-32"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex-shrink-0 w-12 h-12 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white flex items-center justify-center transition-colors"
              aria-label="Odeslat zprávu"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
