import { createAnthropic } from '@ai-sdk/anthropic';
import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  'You are a helpful AI assistant for a premium POS system. You have access to sales analytics. Use the getTopProducts tool to identify best-selling items when the user asks about product performance.';

export const maxDuration = 30;

type TopProduct = {
  productId: string;
  productName: string;
  quantitySold: number;
};

async function fetchTopProductsFromSales(
  userId: string,
  storeId: string,
  limit: number
): Promise<TopProduct[]> {
  const salesSnapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('stores')
    .doc(storeId)
    .collection('sales')
    .get();

  const quantityByProduct = new Map<string, TopProduct>();

  for (const saleDoc of salesSnapshot.docs) {
    const items = (saleDoc.data().items ?? []) as Array<{
      productId?: string;
      productName?: string;
      quantity?: number;
    }>;

    for (const item of items) {
      if (!item.productId) continue;

      const existing = quantityByProduct.get(item.productId);
      const quantity = item.quantity ?? 0;

      if (existing) {
        existing.quantitySold += quantity;
        continue;
      }

      quantityByProduct.set(item.productId, {
        productId: item.productId,
        productName: item.productName ?? 'Unknown product',
        quantitySold: quantity,
      });
    }
  }

  return Array.from(quantityByProduct.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
}

async function fetchTopProductsFromCatalog(
  userId: string,
  storeId: string,
  limit: number
): Promise<TopProduct[]> {
  const productsSnapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('stores')
    .doc(storeId)
    .collection('products')
    .get();

  return productsSnapshot.docs
    .map((productDoc) => {
      const data = productDoc.data();
      return {
        productId: productDoc.id,
        productName: (data.name as string) ?? 'Unknown product',
        quantitySold: (data.soldCount as number) ?? 0,
      };
    })
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
}

export async function POST(req: Request) {
  try {
    const {
      messages,
      storeId,
      userId,
    }: { messages: UIMessage[]; storeId?: string; userId?: string } = await req.json();

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: {
        getTopProducts: tool({
          description: 'Returns the top-selling products for the current store by quantity sold.',
          inputSchema: z.object({
            limit: z
              .number()
              .int()
              .min(1)
              .max(50)
              .default(5)
              .describe('Number of top products to return'),
          }),
          execute: async ({ limit }) => {
            if (!storeId || !userId) {
              return {
                error: 'Missing store context. storeId and userId are required.',
                products: [] as TopProduct[],
              };
            }

            try {
              const fromSales = await fetchTopProductsFromSales(userId, storeId, limit);
              if (fromSales.length > 0) {
                return { products: fromSales, source: 'sales' as const };
              }

              const fromProducts = await fetchTopProductsFromCatalog(userId, storeId, limit);
              return { products: fromProducts, source: 'products' as const };
            } catch (error) {
              console.error('❌ getTopProducts tool error:', error);
              return {
                error: 'Failed to load top products from Firebase.',
                products: [] as TopProduct[],
              };
            }
          },
        }),
      },
      stopWhen: stepCountIs(5),
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
