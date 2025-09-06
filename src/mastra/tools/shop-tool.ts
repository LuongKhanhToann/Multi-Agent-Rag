import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { embed, generateText } from "ai";
import { Client } from 'pg';
import dotenv from "dotenv";

dotenv.config(); 

// ---- Interface định nghĩa row kết quả ----
interface ProductEmbeddingRow {
  product_id: number;
  similarity?: number;
}

// ---- Interface cho product API response ----
interface ProductApiResponse {
  id: number;
  name: string;
  description?: string;
  price?: number;
  image_url?: string;
  stock_quantity?: number;
}

// ---- Kết nối PostgreSQL trực tiếp ----
const dbClient = new Client({
  connectionString: process.env.PG_DATABASE_URL,
});

dbClient.connect().catch(console.error);

// --- Filter với LLM ---
function cleanJSONResponse(text: string): string {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

async function rerankWithLLM(
  input: string,
  products: any[]
): Promise<any[]> {
  const productListText = products.map((p, idx) => 
    `${idx + 1}. ${p.name} (ID: ${p.productId}) - ${p.description} - Giá: ${p.price}`
  ).join("\n");

  const { text } = await generateText({
    model: openai("gpt-4o-mini"), // hoặc model nhẹ hơn tùy nhu cầu
    prompt: `
Người dùng hỏi: "${input}"

Danh sách sản phẩm topK từ vector search:
${productListText}

Hãy chọn ra sản phẩm thực sự phù hợp nhất với nhu cầu người dùng.
Chỉ trả về JSON dạng:
[
  { "productId": "id", "relevance": số từ 0-1 }
]
    `,
  });

  try {
    const cleaned = cleanJSONResponse(text);
    const parsed = JSON.parse(cleaned);
    const relevanceMap = new Map(parsed.map((p: any) => [p.productId, p.relevance]));

    return products
      .map(p => ({
        ...p,
        relevance: relevanceMap.get(p.productId) ?? 0,
      }))
      .filter(p => p.relevance > 0.3) // threshold relevance
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  } catch (e) {
    console.error("Parse JSON fail:", e, text);
    return products;
  }
}

// ---- Định nghĩa Tool ----
export const shopTool = createTool({
  id: "shop-tool",
  description:
    "Tìm sản phẩm tương đồng yêu cầu người dùng từ vector similarity và trả về chi tiết đầy đủ của sản phẩm",
  inputSchema: z.object({
    input: z.string().describe("Nội dung yêu cầu từ người dùng"),
    limit: z.number().optional().default(5).describe("Số lượng sản phẩm tối đa trả về"),
    minSimilarity: z.number().optional().default(0.1).describe("Độ tương đồng tối thiểu (0-1)")
  }),
  outputSchema: z.object({
    products: z.array(
      z.object({
        productId: z.string(),
        name: z.string(),
        description: z.string(),
        price: z.number(),
        similarity: z.number(),
        stock_quantity: z.number().optional(),
        image_url: z.string().optional(),
        available: z.boolean().optional()
      })
    ),
    searchQuery: z.string(),
    totalFound: z.number()
  }),
  execute: async ({ context }) => {
    const { input, limit = 5, minSimilarity = 0.1 } = context;

    try {
      // B1: Tạo embedding từ input user
      const result = await embed({
        value: input,
        model: openai.embedding("text-embedding-3-small"),
      });

      // B2: Query với cosine similarity sử dụng pgvector
      const queryText = `
        SELECT 
          pe.product_id,
          1 - (pe.embedding <=> $1::vector) as similarity
        FROM product_embeddings pe
        WHERE 1 - (pe.embedding <=> $1::vector) >= $3
        ORDER BY pe.embedding <=> $1::vector
        LIMIT $2;
      `;

      const embeddingString = `[${result.embedding.join(',')}]`;
      const dbResult = await dbClient.query(queryText, [embeddingString, limit, minSimilarity]);
      const rows = dbResult.rows as ProductEmbeddingRow[];

      if (rows.length === 0) {
        return {
          products: [],
          searchQuery: input,
          totalFound: 0
        };
      }

      const productIds = rows.map(row => row.product_id);
      const products = await fetchProductsBatch(productIds, rows);
      const rerankedProducts = await rerankWithLLM(input, products);

      return {
        products: rerankedProducts,
        searchQuery: input,
        totalFound: products.length
      };

    } catch (error: any) {
      console.error("Lỗi trong shop tool:", error);
      throw new Error(`Shop tool error: ${error.message || error}`);
    }
  },
});

// ---- Helper function để fetch products theo batch ----
async function fetchProductsBatch(
  productIds: number[], 
  similarityRows: ProductEmbeddingRow[]
): Promise<any[]> {
  const similarityMap = new Map();
  similarityRows.forEach(row => {
    similarityMap.set(row.product_id, row.similarity);
  });

  const products: any[] = [];
  const fetchPromises = productIds.map(async (productId) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://localhost:3000/products/${productId}`, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const product: ProductApiResponse = await response.json();

      return {
        productId: String(productId),
        name: product.name || 'N/A',
        description: product.description || 'Không có mô tả',
        price: product.price || 0,
        similarity: similarityMap.get(productId) || 0,
        stock_quantity: product.stock_quantity,
        image_url: product.image_url,
        available: (product.stock_quantity || 0) > 0,
      };
    } catch (error) {
      console.error(`Lỗi khi fetch sản phẩm ${productId}:`, error);
      return {
        productId: String(productId),
        name: `Sản phẩm ID ${productId}`,
        description: 'Không thể tải thông tin chi tiết',
        price: 0,
        similarity: similarityMap.get(productId) || 0,
        stock_quantity: 0,
        image_url: null,
        available: false,
      };
    }
  });

  const results = await Promise.allSettled(fetchPromises);
  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      products.push(result.value);
    }
  });

  return products.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
}
