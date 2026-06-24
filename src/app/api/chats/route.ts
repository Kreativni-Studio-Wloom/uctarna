import { NextResponse } from 'next/server';
import { getUserChats } from '@/lib/firebase-admin';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const storeId = searchParams.get('storeId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const chats = await getUserChats(userId);
    const filtered = storeId ? chats.filter((chat) => chat.storeId === storeId) : chats;

    return NextResponse.json({ chats: filtered });
  } catch (error) {
    console.error('❌ Error fetching user chats:', error);
    return NextResponse.json({ error: 'Failed to load chats' }, { status: 500 });
  }
}
