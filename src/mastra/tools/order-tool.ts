import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Client } from 'pg';
import dotenv from "dotenv";

dotenv.config(); 

// ---- Interface định nghĩa các response ----
interface CustomerResponse {
  id: number;
  full_name: string;
  phone_number: string;
  address: string;
}

interface OrderResponse {
  id: number;
  customerId: number;
  total_price: number;
  discount?: number;
  status: string;
  customer?: any;
  orderDetails?: any[];
}

interface OrderDetailResponse {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  price: number;
  order?: any;
}

// ---- Kết nối PostgreSQL trực tiếp ----
const dbClient = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Kết nối database
dbClient.connect().catch(console.error);

// ---- Định nghĩa Order Tool ----
export const orderTool = createTool({
  id: "order-tool",
  description:
    "Tạo đơn hàng mới bao gồm thông tin customer, order và chi tiết đơn hàng",
  inputSchema: z.object({
    // Thông tin khách hàng
    customer: z.object({
      full_name: z.string().describe("Tên đầy đủ của khách hàng"),
      phone_number: z.string().describe("Số điện thoại khách hàng"),
      address: z.string().describe("Địa chỉ khách hàng"),
    }),
    
    // Thông tin đơn hàng và sản phẩm
    order: z.object({
      discount: z.number().optional().describe("Giảm giá (%)"),
      status: z.string().default("pending").describe("Trạng thái đơn hàng"),
      productId: z.number().describe("ID sản phẩm từ RAG search"),
      quantity: z.number().describe("Số lượng"),
      price: z.number().describe("Giá sản phẩm"),
    }),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      customer: z.object({
        id: z.number(),
        full_name: z.string(),
        phone_number: z.string(),
        address: z.string(),
      }).optional(),
      order: z.object({
        id: z.number(),
        customerId: z.number(),
        total_price: z.number(),
        discount: z.number().optional(),
        status: z.string(),
      }).optional(),
      orderDetail: z.object({
        id: z.number(),
        orderId: z.number(),
        productId: z.number(),
        quantity: z.number(),
        price: z.number(),
      }).optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context }) => {
    const { customer, order } = context;

    // Lưu trữ các ID được tạo để cleanup nếu cần
    let createdIds: {
      customerId: number | null;
      orderId: number | null;
      orderDetailId: number | null;
    } = {
      customerId: null,
      orderId: null,
      orderDetailId: null
    };

    try {
      // B1: Tạo customer
      console.log("Đang tạo customer...");
      const customerResponse = await fetch("http://localhost:3000/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(customer),
      });

      if (!customerResponse.ok) {
        const errorText = await customerResponse.text();
        throw new Error(`Lỗi tạo customer: ${customerResponse.status} - ${errorText}`);
      }

      const customerData: CustomerResponse = await customerResponse.json();
      createdIds.customerId = customerData.id;
      console.log("Tạo customer thành công:", customerData);

      // B2: Tạo đơn hàng cơ bản
      console.log("Đang tạo order...");
      const orderPayload = {
        customerId: customerData.id,
        discount: order.discount || 0,
        status: order.status || "pending",
      };

      const orderResponse = await fetch("http://localhost:3000/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderPayload),
      });

      if (!orderResponse.ok) {
        const errorText = await orderResponse.text();
        throw new Error(`Lỗi tạo order: ${orderResponse.status} - ${errorText}`);
      }

      const orderData: OrderResponse = await orderResponse.json();
      createdIds.orderId = orderData.id;
      console.log("Tạo order thành công:", orderData);

      // B3: Tạo chi tiết đơn hàng
      console.log("Đang tạo order detail...");
      const orderDetailPayload = {
        orderId: orderData.id,
        productId: order.productId,
        quantity: order.quantity,
      };

      const orderDetailResponse = await fetch("http://localhost:3000/order-details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderDetailPayload),
      });

      if (!orderDetailResponse.ok) {
        const errorText = await orderDetailResponse.text();
        throw new Error(`Lỗi tạo order detail: ${orderDetailResponse.status} - ${errorText}`);
      }

      const orderDetailData: OrderDetailResponse = await orderDetailResponse.json();
      createdIds.orderDetailId = orderDetailData.id;
      console.log("Tạo order detail thành công:", orderDetailData);

      // Lấy thông tin order đã được cập nhật total_price
      const updatedOrderResponse = await fetch(`http://localhost:3000/orders/${orderData.id}`);
      if (updatedOrderResponse.ok) {
        const updatedOrder = await updatedOrderResponse.json();
        orderData.total_price = updatedOrder.total_price;
      }

      // Trả về kết quả thành công
      return {
        success: true,
        message: "Đơn hàng đã được tạo thành công!",
        data: {
          customer: {
            id: customerData.id,
            full_name: customerData.full_name,
            phone_number: customerData.phone_number,
            address: customerData.address,
          },
          order: {
            id: orderData.id,
            customerId: orderData.customerId,
            total_price: orderData.total_price,
            discount: orderData.discount,
            status: orderData.status,
          },
          orderDetail: {
            id: orderDetailData.id,
            orderId: orderDetailData.orderId,
            productId: orderDetailData.productId,
            quantity: orderDetailData.quantity,
            price: orderDetailData.price,
          },
        },
      };

    } catch (error) {
      console.error("Lỗi trong order tool:", error);
      
      // Cleanup: Xóa các records đã tạo theo thứ tự ngược lại
      console.log("Đang thực hiện cleanup...");
      
      // Xóa order detail nếu đã tạo
      if (createdIds.orderDetailId) {
        try {
          await fetch(`http://localhost:3000/order-details/${createdIds.orderDetailId}`, {
            method: "DELETE"
          });
          console.log("Đã xóa order detail:", createdIds.orderDetailId);
        } catch (cleanupError) {
          console.error("Lỗi cleanup order detail:", cleanupError);
        }
      }

      // Xóa order nếu đã tạo
      if (createdIds.orderId) {
        try {
          await fetch(`http://localhost:3000/orders/${createdIds.orderId}`, {
            method: "DELETE"
          });
          console.log("Đã xóa order:", createdIds.orderId);
        } catch (cleanupError) {
          console.error("Lỗi cleanup order:", cleanupError);
        }
      }

      // Xóa customer nếu đã tạo
      if (createdIds.customerId) {
        try {
          await fetch(`http://localhost:3000/customers/${createdIds.customerId}`, {
            method: "DELETE"
          });
          console.log("Đã xóa customer:", createdIds.customerId);
        } catch (cleanupError) {
          console.error("Lỗi cleanup customer:", cleanupError);
        }
      }

      return {
        success: false,
        message: "Không thể tạo đơn hàng",
        error: error instanceof Error ? error.message : "Lỗi không xác định",
      };
    }
  },
});