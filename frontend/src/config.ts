/**
 * Legacy DeepSeek client config (app now uses backend /get-puzzle).
 * Never commit real API keys — use backend/.env instead.
 */
export const DEEPSEEK_API_KEY = '';

/** Fast model that worked well in Postman; change if you prefer v4-pro. */
export const DEEPSEEK_MODEL = 'deepseek-chat';

export const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
