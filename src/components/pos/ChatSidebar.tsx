'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquarePlus, MessagesSquare } from 'lucide-react';

export type ChatListItem = {
  id: string;
  title: string | null;
  messageCount: number;
  updatedAt: string | null;
};

interface ChatSidebarProps {
  userId?: string;
  storeId: string;
  activeChatId: string;
  refreshKey?: number;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
}

function formatChatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  userId,
  storeId,
  activeChatId,
  refreshKey = 0,
  onSelectChat,
  onNewChat,
}) => {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    if (!userId) {
      setChats([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ userId, storeId });
      const response = await fetch(`/api/chats?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Nepodařilo se načíst historii chatů.');
      }

      const data = (await response.json()) as { chats: ChatListItem[] };
      setChats(data.chats);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Nepodařilo se načíst historii chatů.');
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, [userId, storeId]);

  useEffect(() => {
    void loadChats();
  }, [loadChats, refreshKey]);

  return (
    <aside className="w-full md:w-72 flex-shrink-0 card-elevated flex flex-col h-auto min-h-[240px] max-h-[48vh] md:h-[calc(100vh-16rem)] md:max-h-none md:min-h-[480px] overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 text-sm font-medium transition-colors"
        >
          <MessageSquarePlus className="h-4 w-4" />
          Nový chat
        </button>
      </div>

      <div className="px-4 pt-4 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Historie chatů
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Načítám…
          </div>
        ) : error ? (
          <p className="px-2 py-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : chats.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <MessagesSquare className="h-8 w-8 mx-auto mb-2 opacity-60" />
            Zatím žádné uložené chaty
          </div>
        ) : (
          <ul className="space-y-1">
            {chats.map((chat) => {
              const isActive = chat.id === activeChatId;
              const title = chat.title?.trim() || 'Chat bez názvu';

              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat.id)}
                    className={`w-full text-left rounded-xl px-3 py-3 transition-colors ${
                      isActive
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700/60 text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <p className="text-sm font-medium line-clamp-2">{title}</p>
                    <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
                      {chat.messageCount} zpráv
                      {chat.updatedAt ? ` · ${formatChatDate(chat.updatedAt)}` : ''}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};
