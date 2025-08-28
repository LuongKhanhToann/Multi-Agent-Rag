import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { Client } from 'pg';

// ---- Interface định nghĩa row kết quả ----
interface ProductEmbeddingRow {
  product_id: number;
  title?: string;
  description?: string;
  price?: number;
  similarity?: number;
}

// ---- Kết nối PostgreSQL trực tiếp ----
const dbClient = new Client({
  connectionString: "postgresql://innovision:innovision_2025@123.31.39.246:5432/innovision_ai_agent",
});

// Kết nối database
dbClient.connect().catch(console.error);

// ---- Định nghĩa Tool ----
export const shopTool = createTool({
  id: "shop-tool",
  description:
    "Tìm sản phẩm tương đồng yêu cầu người dùng từ vector similarity và trả về chi tiết sản phẩm",
  inputSchema: z.object({
    input: z.string().describe("Nội dung yêu cầu từ người dùng"),
  }),
  outputSchema: z.object({
    products: z.array(
      z.object({
        productId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        price: z.number().optional(),
        similarity: z.number().optional(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const { input } = context;

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
        ORDER BY pe.embedding <=> $1::vector
        LIMIT 5;
      `;

      // Chuyển embedding array thành string format cho PostgreSQL vector
      const embeddingString = `[${result.embedding.join(',')}]`;
      
      const dbResult = await dbClient.query(queryText, [embeddingString]);
      const rows = dbResult.rows as ProductEmbeddingRow[];

      // B3: Lấy chi tiết sản phẩm từ API
      const products: any[] = [];
      for (const row of rows) {
        try {
          const response = await fetch(
            `http://localhost:3000/products/${row.product_id}`
          );
          
          if (response.ok) {
            const product = await response.json();
            products.push({
              productId: String(row.product_id),
              title: product.title,
              description: product.description,
              price: product.price,
              similarity: row.similarity,
            });
          }
        } catch (err) {
          console.error(`Lỗi khi gọi API sản phẩm ${row.product_id}:`, err);
        }
      }

      return { products };
    } catch (error) {
      console.error("Lỗi trong shop tool:", error);
      throw error;
    }
  },
});

// Đóng kết nối khi ứng dụng tắt
// process.on('SIGINT', () => {
//   dbClient.end();
//   process.exit(0);
// });