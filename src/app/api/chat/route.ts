import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const result = streamText({
      model: anthropic('claude-3-5-sonnet-20240620'),
      system: 'You are a helpful AI assistant for a premium POS system.',
      messages: await convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('❌ Error in chat API:', error);
    return new Response(JSON.stringify({ error: 'Chat API error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
