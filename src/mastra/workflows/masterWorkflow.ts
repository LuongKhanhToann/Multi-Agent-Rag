import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { retryRequest } from "../retryHelper";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ===== Step chờ trước khi phân loại =====
const waitInputStep = createStep({
  id: "wait-input",
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ input: z.string() }),
  execute: async ({ inputData }) => {
    console.log("inputData tại wait-input:", inputData);
    if (!inputData?.input) {
      throw new Error("[wait-input] Thiếu input");
    }

    console.log("[wait-input] Waiting 35s before classify...");
    await delay(35000);
    return inputData;
  },
});

// ===== Step chờ sau khi phân loại =====
const waitPostClassifyStep = createStep({
  id: "wait-post-classify",
  inputSchema: z.object({ category: z.string(), input: z.string() }),
  outputSchema: z.object({ category: z.string(), input: z.string() }),
  execute: async ({ inputData }) => {
    if (!inputData?.input || !inputData?.category) {
      throw new Error("[wait-post-classify] Thiếu input hoặc category");
    }

    console.log("[wait-post-classify] Waiting 35s before routing...");
    await delay(35000);
    return inputData;
  },
});

// ===== Step phân loại =====
const classifyStep = createStep({
  id: "classify",
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ category: z.string(), input: z.string() }),
  execute: async ({ inputData, mastra }) => {
    const input = inputData?.input?.trim();
    if (!input) {
      throw new Error("[classify] Input rỗng");
    }

    const prompt = `
Bạn là một AI phân loại yêu cầu. Hãy đọc nội dung sau và phân loại nó thành một trong bốn danh mục sau:
- "shop" nếu liên quan đến sản phẩm, cửa hàng
- "order-place" nếu người dùng muốn đặt hàng
- "order-status" nếu người dùng muốn kiểm tra đơn hàng, tra cứu tình trạng giao hàng
- "chat" nếu không thuộc ba nhóm trên

Chỉ trả về duy nhất một từ: "shop", "order-place", "order-status", hoặc "chat".
Yêu cầu: "${input}"
Trả lời (chỉ một từ):
    `.trim();

    const rawAgent = mastra.getAgent("masterAgent");
    if (!rawAgent || typeof rawAgent.generate !== "function") {
      throw new Error("[classify] Không tìm thấy masterAgent");
    }

    const res = await retryRequest(() =>
      rawAgent.generate([{ role: "user", content: prompt }])
    );

    const rawText =
      res?.outputs?.[0]?.text?.trim().toLowerCase() ||
      res?.text?.trim().toLowerCase() || "";

    const validCategories = ["shop", "order-place", "order-status", "chat"];
    const category = validCategories.includes(rawText) ? rawText : "chat";

    console.log(`[classify] Kết quả phân loại: ${category}`);
    return {
      category,
      input,
    };
  },
});

// ===== Step định tuyến đến agent phù hợp =====
const routeStep = createStep({
  id: "route",
  inputSchema: z.object({
    category: z.string(),
    input: z.string(),
  }),
  outputSchema: z.object({ output: z.string() }),
  execute: async ({ inputData, mastra }) => {
    const { category, input } = inputData;

    if (!category || !input) {
      throw new Error("[route] Thiếu input hoặc category");
    }

    const agentMap = {
      shop: "shopAgent",
      "order-place": "orderAgent",
      "order-status": "orderStatusAgent",
      chat: "chatAgent",
    };

    const agentId = agentMap[category] || "chatAgent";
    const targetAgent = mastra.getAgent(agentId);

    if (!targetAgent || typeof targetAgent.generate !== "function") {
      throw new Error(`[route] Agent '${agentId}' không hợp lệ`);
    }

    const res = await retryRequest(() =>
      targetAgent.generate([{ role: "user", content: input }])
    );

    const text = res?.outputs?.[0]?.text?.trim() ?? "";
    console.log(`[route] Trả lời từ agent: ${text}`);

    return { output: text };
  },
});

// ===== Tổng workflow =====
export const masterWorkflow = createWorkflow({
  id: "master-workflow",
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
})
  .then(waitInputStep)
  .then(classifyStep)
  .then(waitPostClassifyStep)
  .then(routeStep)
  .commit();
