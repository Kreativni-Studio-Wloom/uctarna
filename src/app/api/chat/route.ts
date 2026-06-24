import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PRIMARY_MODEL = 'claude-3-5-sonnet-latest';
const FALLBACK_MODEL = 'claude-3-haiku-20240307';

export const maxDuration = 30;

function isModelNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('not_found') ||
    message.includes('404') ||
    message.includes('model not found')
  );
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const modelMessages = await convertToModelMessages(messages);

    try {
      const result = streamText({
        model: anthropic(PRIMARY_MODEL),
        system: 'You are a helpful AI assistant for a premium POS system.',
        messages: modelMessages,
      });

      return result.toUIMessageStreamResponse();
    } catch (error) {
      if (!isModelNotFoundError(error)) throw error;

      console.warn(
        `Model ${PRIMARY_MODEL} not available, falling back to ${FALLBACK_MODEL}`,
        error
      );

      const result = streamText({
        model: anthropic(FALLBACK_MODEL),
        system: 'You are a helpful AI assistant for a premium POS system.',
        messages: modelMessages,
      });

      return result.toUIMessageStreamResponse();
    }
  } catch (error) {
    console.error('❌ Error in chat API:', error);
    return new Response(JSON.stringify({ error: 'Chat API error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
