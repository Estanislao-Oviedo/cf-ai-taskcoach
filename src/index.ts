/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

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
    ctx: ExecutionContext, // ← Make sure this is here
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

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env, ctx); // ← Pass ctx here!
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function getChatHistory(request: Request, env: Env): Promise<Response> {
  request.headers.get("content-type")?.includes("application/json");
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing userId parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  let history: ChatMessage[] = [];
  try {
    if (env.CHAT_HISTORY && typeof env.CHAT_HISTORY.get === "function") {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      history = stored ? JSON.parse(stored) : [];
    }
  } catch (err) {
    console.warn("Failed to read CHAT_HISTORY:", err);
    history = [];
  }
  const response = new Response(JSON.stringify({ history }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  return response;
}

/**
 * Handles chat API requests - SSE Format Fixed
 */
async function handleChatRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  console.log("=== handleChatRequest called ===");
  console.log("ctx is:", ctx);
  console.log("ctx type:", typeof ctx);
  
  try {
    const body = await request.json().catch((e) => {
      console.error("JSON parse failed:", e);
      return null;
    });
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { userId, messages: incoming } = body as {
      userId?: string;
      messages?: unknown;
    };

    if (!userId || typeof userId !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
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

    let history: ChatMessage[] = [];
    try {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      history = stored ? JSON.parse(stored) : [];
    } catch (err) {
      console.warn("Failed to read CHAT_HISTORY:", err);
    }

    const messages: ChatMessage[] = [...history, ...incomingMessages];

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // Create a promise to track when we should save to KV
    let resolveHistorySave: ((text: string) => void) | null = null;
    const historySavePromise = new Promise<string>((resolve) => {
      resolveHistorySave = resolve;
    });

    // Schedule the KV save using ctx.waitUntil
    ctx.waitUntil(
      historySavePromise.then(async (responseText) => {
        if (responseText) {
          messages.push({ role: "assistant", content: responseText });
          try {
            await env.CHAT_HISTORY.put(
              `history:${userId}`,
              JSON.stringify(messages),
              { expirationTtl: 60 * 60 * 24 * 7 }
            );
            console.log("Saved to history. Total response length:", responseText.length);
          } catch (err) {
            console.warn("Failed to save history:", err);
          }
        }
      })
    );

    // Create a custom ReadableStream with SSE parsing
    let responseText = "";
    let buffer = ""; // Buffer for incomplete lines
    
    const customStream = new ReadableStream({
      async start(controller) {
        try {
          const aiStream = await env.AI.run(MODEL_ID, {
            messages,
            max_tokens: 1024,
            stream: true,
          }) as ReadableStream;

          const reader = aiStream.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Send chunk to client immediately
            controller.enqueue(value);

            // Also parse for history - accumulate in buffer
            buffer += decoder.decode(value, { stream: true });
            
            // Process complete lines (ending with \n)
            const lines = buffer.split("\n");
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim() || line === "data: [DONE]") continue;
              
              // Remove "data: " prefix for SSE format
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
          }

          // Process any remaining buffered content
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
              // Ignore
            }
          }

          controller.close();

          // Trigger the KV save
          if (resolveHistorySave) {
            resolveHistorySave(responseText);
          }
        } catch (error) {
          console.error("Stream error:", error);
          controller.error(error);
          // Still resolve the promise to prevent hanging
          if (resolveHistorySave) {
            resolveHistorySave("");
          }
        }
      }
    });

    return new Response(customStream, {
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