import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Client } from 'pg';
import dotenv from "dotenv";

dotenv.config();

// ---- Interface định nghĩa response ----
interface FeedbackResponse {
  id: number;
  customerId: number;
  rating: number;
  comment?: string;
  feedback_type: string;
  created_at?: string;
}

// ---- Kết nối PostgreSQL trực tiếp ----
const dbClient = new Client({
  connectionString: process.env.PG_DATABASE_URL,
});

// Kết nối database
dbClient.connect().catch(console.error);

// ---- Định nghĩa Feedback Tool ----
export const feedbackTool = createTool({
  id: "feedback-tool",
  description: "Thu thập và lưu feedback của khách hàng về dịch vụ, sản phẩm hoặc trải nghiệm mua hàng",
  
  inputSchema: z.object({
    customerId: z.number().describe("ID của khách hàng"),
    rating: z.number().min(1).max(5).describe("Điểm đánh giá từ 1-5 sao"),
    comment: z.string().optional().describe("Nhận xét của khách hàng (tùy chọn)"),
    feedback_type: z.enum(["order_process", "product", "customer_service", "other"]).describe("Loại feedback: order_process/product/customer_service/other"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      feedback: z.object({
        id: z.number(),
        customerId: z.number(),
        rating: z.number(),
        comment: z.string().optional(),
        feedback_type: z.string(),
        created_at: z.string().optional(),
      }).optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context }) => {
    const { customerId, rating, comment, feedback_type } = context;

    try {
      console.log("Đang tạo feedback...");
      
      // Tạo feedback payload
      const feedbackPayload = {
        customerId,
        rating,
        comment: comment || "",
        feedback_type,
      };

      // Gọi API để tạo feedback
      const feedbackResponse = await fetch("http://localhost:3000/feedback-customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(feedbackPayload),
      });

      if (!feedbackResponse.ok) {
        const errorText = await feedbackResponse.text();
        throw new Error(`Lỗi tạo feedback: ${feedbackResponse.status} - ${errorText}`);
      }

      const feedbackData: FeedbackResponse = await feedbackResponse.json();
      console.log("Tạo feedback thành công:", feedbackData);

      // Trả về kết quả thành công
      return {
        success: true,
        message: "Cảm ơn anh/chị đã để lại đánh giá! Ý kiến của anh/chị rất quý giá với chúng tôi.",
        data: {
          feedback: {
            id: feedbackData.id,
            customerId: feedbackData.customerId,
            rating: feedbackData.rating,
            comment: feedbackData.comment,
            feedback_type: feedbackData.feedback_type,
            created_at: feedbackData.created_at,
          },
        },
      };

    } catch (error) {
      console.error("Lỗi trong feedback tool:", error);
      
      return {
        success: false,
        message: "Có lỗi xảy ra khi lưu đánh giá. Vui lòng thử lại sau.",
        error: error instanceof Error ? error.message : "Lỗi không xác định",
      };
    }
  },
});