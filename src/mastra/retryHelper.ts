// retryHelper.ts

export const retryRequest = async (
  func: () => Promise<any>,
  retries = 5,
  delay = 35000 // 60s
): Promise<any> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await func(); // Thử thực thi yêu cầu
    } catch (error: any) {
      if (error?.response?.status === 429) {
        console.log(`Rate limit hit. Retrying in ${delay / 1000}s (Attempt ${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error; // Không phải lỗi 429 thì ném lỗi ra luôn
      }
    }
  }
  throw new Error('Maximum retry attempts reached.');
};
