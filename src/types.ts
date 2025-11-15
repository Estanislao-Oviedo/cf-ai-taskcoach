/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };

  CHAT_HISTORY: KVNamespace;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Represents a single conversation.
 */
export interface Chat {
  name: string;
  messages: ChatMessage[];
}

/**
 * Represents a user's collection of conversations.
 */
export interface UserChats {
  [chatId: string]: Chat;
}
