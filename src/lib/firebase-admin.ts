import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { UIMessage } from 'ai';

function initAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    return initializeApp({
      credential: cert(JSON.parse(serviceAccountKey)),
    });
  }

  return initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'prodejni-system-uctarna',
  });
}

export const adminDb = getFirestore(initAdminApp());

export type StoredChatMessage = {
  id: string;
  role: UIMessage['role'];
  parts: UIMessage['parts'];
};

export type ChatHistory = {
  id: string;
  userId: string;
  storeId: string;
  title: string | null;
  messages: StoredChatMessage[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type ChatSummary = {
  id: string;
  userId: string;
  storeId: string;
  title: string | null;
  messageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function sanitizeForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function extractChatTitle(messages: UIMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== 'user') continue;

    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) {
        return part.text.trim().slice(0, 120);
      }
    }
  }

  return null;
}

function serializeMessages(messages: UIMessage[]): StoredChatMessage[] {
  return messages.map((message) =>
    sanitizeForFirestore({
      id: message.id,
      role: message.role,
      parts: message.parts,
    })
  );
}

export async function saveChat(params: {
  chatId: string;
  userId: string;
  storeId: string;
  messages: UIMessage[];
}): Promise<void> {
  const { chatId, userId, storeId, messages } = params;
  const chatRef = adminDb.collection('chats').doc(chatId);
  const existing = await chatRef.get();
  const title = extractChatTitle(messages) ?? (existing.data()?.title as string | undefined) ?? null;

  await chatRef.set(
    {
      userId,
      storeId,
      title,
      messages: serializeMessages(messages),
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function getChatHistory(chatId: string): Promise<ChatHistory | null> {
  const chatDoc = await adminDb.collection('chats').doc(chatId).get();
  if (!chatDoc.exists) return null;

  const data = chatDoc.data()!;
  return {
    id: chatDoc.id,
    userId: (data.userId as string) ?? '',
    storeId: (data.storeId as string) ?? '',
    title: (data.title as string | undefined) ?? null,
    messages: (data.messages as StoredChatMessage[]) ?? [],
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export async function getUserChats(userId: string): Promise<ChatSummary[]> {
  const snapshot = await adminDb.collection('chats').where('userId', '==', userId).get();

  return snapshot.docs
    .map((chatDoc) => {
      const data = chatDoc.data();
      const messages = (data.messages as StoredChatMessage[] | undefined) ?? [];

      return {
        id: chatDoc.id,
        userId: (data.userId as string) ?? userId,
        storeId: (data.storeId as string) ?? '',
        title: (data.title as string | undefined) ?? null,
        messageCount: messages.length,
        createdAt: timestampToIso(data.createdAt),
        updatedAt: timestampToIso(data.updatedAt),
      };
    })
    .sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bTime - aTime;
    });
}
