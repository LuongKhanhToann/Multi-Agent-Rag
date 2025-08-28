import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Client } from 'pg';

// ---- Tool để kiểm tra đơn hàng ----
export const getOrderTool = createTool({
  id: "get-order-tool",
  description: "Lấy thông tin đơn hàng theo ID",
  inputSchema: z.object({
    orderId: z.number().describe("ID của đơn hàng cần tra cứu"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    order: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { orderId } = context;

    try {
      const response = await fetch(`http://localhost:3000/orders/${orderId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            message: `Không tìm thấy đơn hàng với ID: ${orderId}`,
            error: "Order not found",
          };
        }
        
        const errorText = await response.text();
        throw new Error(`Lỗi khi lấy đơn hàng: ${response.status} - ${errorText}`);
      }

      const order = await response.json();
      
      return {
        success: true,
        message: "Lấy thông tin đơn hàng thành công",
        order: order,
      };
    } catch (error) {
      console.error("Lỗi trong get order tool:", error);
      
      return {
        success: false,
        message: "Không thể lấy thông tin đơn hàng",
        error: error instanceof Error ? error.message : "Lỗi không xác định",
      };
    }
  },
});