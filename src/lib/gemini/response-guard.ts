import {
  validateChatbotResponse,
  extractCurrencyAmounts,
  type ChatbotValidationInput,
  type ChatbotValidationResult,
} from '../chatbot/responseValidator';

export type ResponseGuardInput = ChatbotValidationInput;
export type ResponseGuardResult = ChatbotValidationResult;

export { extractCurrencyAmounts };

export function validateGeminiResponse(input: ResponseGuardInput): ResponseGuardResult {
  return validateChatbotResponse(input);
}
