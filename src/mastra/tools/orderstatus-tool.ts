import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const orderStatusTool = createTool({
  id: "order-status-tool",
  description: "Tra cứu đơn hàng theo số điện thoại và sản phẩm",
  inputSchema: z.object({
    phone: z.string().describe("Số điện thoại khách hàng"),
    productId: z.number().describe("ID sản phẩm cần tra cứu"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    orders: z
      .array(
        z.object({
          id: z.number(),
          total_price: z.number(),
          discount: z.number().nullable().optional(),
          status: z.string(),
          phone_number: z.string(),
          customerId: z.number(),
          created_at: z.string(),
          updated_at: z.string(),
          customer: z.any().optional(),
          orderDetails: z.any().optional(),
          payments: z.any().optional(),
        })
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { phone, productId } = context;
    const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

    try {
      const res = await fetch(
        `${API_BASE_URL}/orders/search?phoneNumber=${encodeURIComponent(phone)}&productId=${productId}`
      );

      if (!res.ok) {
        if (res.status === 404) {
          return {
            success: false,
            message: "Không tìm thấy đơn hàng cho thông tin đã cung cấp",
            orders: [],
          };
        }
        const errorText = await res.text();
        throw new Error(`API error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      const orders = data.orders || [];

      return {
        success: true,
        message: "Tra cứu đơn hàng thành công",
        orders,
      };
    } catch (error) {
      console.error("❌ Lỗi trong orderStatusTool:", error);
      return {
        success: false,
        message: "Không thể tra cứu đơn hàng",
        error: error instanceof Error ? error.message : "Lỗi không xác định",
        orders: [],
      };
    }
  },
});
