/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage, UserChats } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/history") {
      // Handle GET requests for chat history
      if (request.method === "GET") {
        return getChatHistory(request, env);
      }
      // Handle DELETE request for chat history
      if (request.method === "DELETE") {
        return deleteChatHistory(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/conversations") {
      // Handle GET requests for conversastions
      if (request.method === "GET") {
        return getConversations(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env, ctx);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// Get chat conversation history
async function getChatHistory(request: Request, env: Env): Promise<Response> {
  request.headers.get("content-type")?.includes("application/json");
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const chatId = url.searchParams.get("chatId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing userId parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!chatId) {
    return new Response(JSON.stringify({ error: "Missing chatId parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  let userChats: UserChats = {}
  let history: ChatMessage[] = [];
  try {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      if (stored) {
        userChats = JSON.parse(stored);
        history = userChats[chatId]?.messages || [];
      }
  } catch (err) {
    console.warn("Failed to read CHAT_HISTORY:", err);
    return new Response(JSON.stringify({ error: "Failed to load chat history" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const response = new Response(JSON.stringify({ history }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  return response;
}

// Delete chat conversation history
async function deleteChatHistory(request: Request, env: Env): Promise<Response> {
  request.headers.get("content-type")?.includes("application/json");
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const chatId = url.searchParams.get("chatId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing userId parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!chatId) {
    return new Response(JSON.stringify({ error: "Missing chatId parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  let userChats: UserChats = {}
  try {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      if (stored) {
        userChats = JSON.parse(stored);
      }
      if (userChats[chatId]) {
        delete userChats[chatId];
      }
      await env.CHAT_HISTORY.put(
        `history:${userId}`,
        JSON.stringify(userChats),
        { expirationTtl: 60 * 60 * 24 * 7 }
      );
  } catch (err) {
    console.warn("Failed to delete chat:", err);
    return new Response(JSON.stringify({ error: "Failed to delete chat" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const response = new Response(JSON.stringify({ message: "Chat deleted" }),{
    status: 200,
    headers: { "content-type": "application/json" },
  });
  return response;
}

// Get all user chat conversations names and their IDs
async function getConversations(request: Request, env: Env): Promise<Response> {
  request.headers.get("content-type")?.includes("application/json");
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing userId parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  let userChats: UserChats = {}
  try {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      if (stored) {
        userChats = JSON.parse(stored);
      }
  } catch (err) {
    console.warn("Failed to read CHAT_HISTORY:", err);
    return new Response(JSON.stringify({ error: "Failed to load conversations" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const chatNames = Object.entries(userChats).map(([chatId, chat]) => ({
    chatId,
    name: chat.name,
  }));
  const response = new Response(JSON.stringify({ chats: chatNames }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  return response;
}

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { userId, chatId, messages: incoming } = body as {
      userId?: string;
      chatId?: string;
      messages?: unknown;
    };

    if (!userId || typeof userId !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (!chatId || typeof chatId !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid chatId" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    let incomingMessages: ChatMessage[] = [];
    if (Array.isArray(incoming)) {
      incomingMessages = incoming.map((m) => {
        if (typeof m === "string") return { role: "user", content: m };
        if (m && typeof m === "object") {
          const role = (m as any).role as ChatMessage["role"] | undefined;
          const content = (m as any).content ?? String(m);
          return { role: role ?? "user", content: String(content) };
        }
        return { role: "user", content: String(m) };
      });
    }

    let userChats: UserChats = {};
    let history: ChatMessage[] = [];
    try {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      userChats = stored ? JSON.parse(stored) : {};
      if (userChats[chatId]) {
        history = userChats[chatId].messages;
      } else {
        // Create new chat if it doesn't exist
        userChats[chatId] = { name: `Chat ${Object.keys(userChats).length + 1}`, messages: [] };
      }
    } catch (err) {
      console.warn("Failed to read CHAT_HISTORY:", err);
    }
    const messages: ChatMessage[] = [...history, ...incomingMessages];

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // Get AI stream
    const aiStream = await env.AI.run(MODEL_ID, {
      messages,
      max_tokens: 1024,
      stream: true,
    }) as ReadableStream;

    // Use TransformStream to capture response without re-chunking
    let responseText = "";
    let buffer = "";
    
    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        // Pass through immediately - preserves original chunking
        controller.enqueue(chunk);
        
        // Capture for history
        const decoder = new TextDecoder();
        buffer += decoder.decode(chunk, { stream: true });
        
        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.trim() || line === "data: [DONE]") continue;
          
          const jsonStr = line.startsWith("data: ") 
            ? line.slice(6).trim() 
            : line.trim();
          
          if (!jsonStr) continue;
          
          try {
            const jsonData = JSON.parse(jsonStr);
            if (jsonData.response) {
              responseText += jsonData.response;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      },
      
      flush() {
        // Process remaining buffer
        if (buffer.trim() && buffer !== "data: [DONE]") {
          const jsonStr = buffer.startsWith("data: ") 
            ? buffer.slice(6).trim() 
            : buffer.trim();
          try {
            const jsonData = JSON.parse(jsonStr);
            if (jsonData.response) {
              responseText += jsonData.response;
            }
          } catch (e) {
            console.error("Error parsing JSON:", e);
          }
        }
        
        // Update chat history in KV
        if (responseText) {
          messages.push({ role: "assistant", content: responseText });
          userChats[chatId].messages = messages
          ctx.waitUntil(
            env.CHAT_HISTORY.put(
              `history:${userId}`,
              JSON.stringify(userChats),
              { expirationTtl: 60 * 60 * 24 * 7 }
            ).catch(err => console.warn("Failed to save chat history:", err))
          );
          console.log("Saved chat history. Total response length:", responseText.length);
        }
      }
    });

    // Pipe AI stream through transform (preserves chunking)
    aiStream.pipeTo(writable).catch(err => 
      console.warn("Stream pipe error:", err)
    );

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });

  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(JSON.stringify({ 
      error: "Failed to process request",
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}