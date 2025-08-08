import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { PgVector } from "@mastra/pg";

const vectorStore = new PgVector({
  connectionString: "postgresql://user:password@localhost:5432/mydb",
  schemaName: "custom_schema", // optional
});

export const shopTool = createTool({
  id: "shop-tool",
  description: "Tìm sản phẩm tương đồng yêu cầu người dùng từ PGVector",
  inputSchema: z.object({
    input: z.string().describe("Nội dung yêu cầu từ người dùng"),
  }),
  outputSchema: z.object({
    products: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        productId: z.string().optional(),
        price: z.number().optional(),
        score: z.number().optional(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const { input } = context;

    const result = await embed({
      value: input,
      model: openai.embedding("text-embedding-3-small"),
    });

    const results = await vectorStore.query({
      indexName: "product_embeddings",
      queryVector: result.embedding,
      topK: 5,
    });

    const products = results.map((row: any) => ({
      title: row.title,
      description: row.description,
      productId: row.product_id,
      price: row.price,
      score: row.score,
    }));

    return { products };
  },
});
