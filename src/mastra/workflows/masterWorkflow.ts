// ===== Master Workflow Using Mastra Memory Package =====
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";

// ===== Setup Mastra Memory =====
const setupMemory = () => {
  return new Memory({
    storage: new LibSQLStore({
      url: process.env.MEMORY_DB_URL || "file:./memory.db",
    }),
    options: {
      semanticRecall: { 
        topK: 5, 
        messageRange: 10 
      },
      workingMemory: { 
        enabled: true 
      },
    },
  });
};

// Singleton memory instance
let memoryInstance: Memory | null = null;
const getMemory = () => {
  if (!memoryInstance) {
    memoryInstance = setupMemory();
  }
  return memoryInstance;
};

// ===== Step 1: AI Classification (Direct & Simple) =====
const classifyIntentStep = createStep({
  id: "classify-intent",
  inputSchema: z.object({
    input: z.string().default(""),
    sessionId: z.string().default("default"),
    userId: z.string().default("user"),
  }),
  outputSchema: z.object({
    input: z.string(),
    sessionId: z.string(),
    userId: z.string(),
    category: z.enum(["shop", "order_place", "order_status", "chat"]),
    confidence: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { input, sessionId, userId } = inputData;
    
    if (!input?.trim()) {
      return {
        input: "",
        sessionId,
        userId,
        category: "chat" as const,
        confidence: 0.1,
      };
    }

    const classificationPrompt = `
Phân loại ý định của khách hàng vào một trong các danh mục sau:

- shop: Tìm hiểu sản phẩm, so sánh, duyệt danh mục
- order_place: Muốn đặt hàng, mua sản phẩm cụ thể  
- order_status: Hỏi về đơn hàng đã đặt, theo dõi giao hàng
- chat: Chào hỏi, trò chuyện thông thường

INPUT: ${input}

Trả lời chỉ một từ: shop/order_place/order_status/chat`;

    try {
      const masterAgent = mastra?.getAgent("masterAgent");
      if (!masterAgent) {
        throw new Error("Master agent not found");
      }

      const response = await masterAgent.generate([
        { role: "user", content: classificationPrompt }
      ]);

      const result = response?.text?.trim().toLowerCase() || "chat";
      const validCategories = ["shop", "order_place", "order_status", "chat"] as const;
      const category = validCategories.includes(result as any) ? result as any : "chat";
      
      console.log(`[classify] "${input}" → ${category}`);
      
      return {
        input: input.trim(),
        sessionId,
        userId,
        category,
        confidence: 0.8,
      };

    } catch (error) {
      console.error("[classify] AI failed, using fallback:", error);
      
      // Simple fallback based on keywords
      const lowerInput = input.toLowerCase();
      let category: "shop" | "order_place" | "order_status" | "chat" = "chat";
      
      if (lowerInput.includes("mua") || lowerInput.includes("đặt")) {
        category = "order_place";
      } else if (lowerInput.includes("đơn hàng") || lowerInput.includes("giao hàng")) {
        category = "order_status";
      } else if (lowerInput.includes("sản phẩm") || lowerInput.includes("giá")) {
        category = "shop";
      }
      
      return {
        input: input.trim(),
        sessionId,
        userId,
        category,
        confidence: 0.4,
      };
    }
  },
});

// ===== Step 2: Route to Agent with Mastra Memory =====
const routeWithMemoryStep = createStep({
  id: "route-with-memory",
  inputSchema: z.object({
    input: z.string(),
    sessionId: z.string(),
    userId: z.string(),
    category: z.enum(["shop", "order_place", "order_status", "chat"]),
    confidence: z.number(),
  }),
  outputSchema: z.object({
    input: z.string(),
    output: z.string(),
    agentUsed: z.string(),
    category: z.string(),
    processingTime: z.number(),
    memoryUsed: z.boolean(),
  }),
  execute: async ({ inputData, mastra }) => {
    const startTime = Date.now();
    const { input, sessionId, userId, category } = inputData;

    // Agent routing map
    const agentMap: Record<string, string> = {
      shop: "shopAgent",
      order_place: "orderAgent", 
      order_status: "orderStatusAgent",
      chat: "chatAgent",
    };

    const targetAgentId = agentMap[category] || "chatAgent";
    
    try {
      const targetAgent = mastra?.getAgent(targetAgentId);
      if (!targetAgent) {
        throw new Error(`Agent ${targetAgentId} not found`);
      }

      // Use Mastra Memory for conversation context
      const response = await targetAgent.generate(input, {
        memory: {
          resource: userId, // Use userId as resource identifier
          thread: { id: sessionId }, // Use sessionId as thread identifier
        },
      });

      const output = response?.text?.trim() || "Xin lỗi, tôi không thể trả lời lúc này.";
      const processingTime = Date.now() - startTime;

      console.log(`[route-memory] Used ${targetAgentId} for ${category} in ${processingTime}ms with memory`);

      return {
        input,
        output,
        agentUsed: targetAgentId,
        category,
        processingTime,
        memoryUsed: true,
      };

    } catch (error) {
      console.error(`[route-memory] Error with ${targetAgentId}:`, error);
      
      // Fallback to chat agent without memory
      try {
        const chatAgent = mastra?.getAgent("chatAgent");
        if (chatAgent) {
          const response = await chatAgent.generate([
            { role: "user", content: input }
          ]);
          const output = response?.text || "Xin lỗi, hệ thống đang gặp sự cố.";
          
          return {
            input,
            output,
            agentUsed: "chatAgent (fallback)",
            category,
            processingTime: Date.now() - startTime,
            memoryUsed: false,
          };
        }
      } catch (fallbackError) {
        console.error("[route-memory] Fallback failed:", fallbackError);
      }

      const emergencyResponse = "Xin lỗi, hệ thống đang gặp sự cố. Vui lòng thử lại sau.";
      
      return {
        input,
        output: emergencyResponse,
        agentUsed: "error-fallback",
        category,
        processingTime: Date.now() - startTime,
        memoryUsed: false,
      };
    }
  },
});

// ===== Step 3: Format Response =====
const formatResponseStep = createStep({
  id: "format-response",
  inputSchema: z.object({
    input: z.string(),
    output: z.string(),
    agentUsed: z.string(),
    category: z.string(),
    processingTime: z.number(),
    memoryUsed: z.boolean(),
  }),
  outputSchema: z.object({
    input: z.string(),
    output: z.string(),
    metadata: z.object({
      agentUsed: z.string(),
      category: z.string(),
      processingTime: z.number(),
      memoryUsed: z.boolean(),
      timestamp: z.string(),
      responseId: z.string(),
    }),
  }),
  execute: async ({ inputData }) => {
    const { input, output, agentUsed, category, processingTime, memoryUsed } = inputData;
    return {
      input,
      output,
      metadata: {
        agentUsed,
        category,
        processingTime,
        memoryUsed,
        timestamp: new Date().toISOString(),
        responseId: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      },
    };
  },
});

// ===== Master Workflow with Mastra Memory =====
export const masterWorkflow = createWorkflow({
  id: "master-workflow",
  inputSchema: z.object({
    input: z.string().default(""),
    sessionId: z.string().default("default"),
    userId: z.string().default("user"),
  }),
  outputSchema: z.object({
    input: z.string(),
    output: z.string(),
    metadata: z.object({
      agentUsed: z.string(),
      category: z.string(),
      processingTime: z.number(),
      memoryUsed: z.boolean(),
      timestamp: z.string(),
      responseId: z.string(),
    }),
  }),
})
.then(classifyIntentStep)
.then(routeWithMemoryStep)
.then(formatResponseStep)
.commit();

// // ===== Agent Configuration with Memory =====
export const createAgentsWithMemory = () => {
  const memory = getMemory();
  
  return {
    // Memory configuration for each agent
    memoryConfig: {
      memory, // Pass to agent configurations
    },
    
    // Helper to create agent with memory
    createAgentWithMemory: (agentConfig: any) => ({
      ...agentConfig,
      memory,
    }),
  };
};


// Export memory instance
export { getMemory };