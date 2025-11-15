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
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/history") {
      // Handle POST requests for chat
      if (request.method === "GET") {
        return getChatHistory(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Parse JSON request body
    const body = await request.json().catch(() => null);
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

    // Normalize incoming messages to ChatMessage[]
    let incomingMessages: ChatMessage[] = [];
    if (Array.isArray(incoming)) {
      incomingMessages = incoming.map((m) => {
        if (typeof m === "string") return { role: "user", content: m };
        if (m && typeof m === "object") {
          // Accept both { role, content } shapes or { content } strings
          const role = (m as any).role as ChatMessage["role"] | undefined;
          const content = (m as any).content ?? String(m);
          return { role: role ?? "user", content: String(content) };
        }
        return { role: "user", content: String(m) };
      });
    }

    // Load history from KV
    let history: ChatMessage[] = [];
    try {
      const stored = await env.CHAT_HISTORY.get(`history:${userId}`);
      history = stored ? JSON.parse(stored) : [];
    } catch (err) {
      console.warn("Failed to read CHAT_HISTORY:", err);
      history = [];
    }

    // Merge history with incoming messages (history first)
    const messages: ChatMessage[] = [...history, ...incomingMessages];

    // Add system prompt if not present
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const aiResponse = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
      },
    );

    // If the AI response has a streaming body, tee it so we can both return
    // a stream to the client and read a copy here to persist the assistant
    // message to KV when complete.
    try {
      console.log(1)
      const body = aiResponse.body;
      if (body && typeof body.tee === "function") {
        console.log(2)
        const [streamForClient, streamForProcessing] = body.tee();

        // Start background task to collect assistant text from the streamed chunks
        (async () => {
          try {
            console.log(3)
            const reader = streamForProcessing.getReader();
            const decoder = new TextDecoder();
            let responseText = "";
            console.log("before true")
            while (true) {
              console.log("before true2 2")
              const { done, value } = await reader.read();
              console.log(" await")
              console.log(done)
              console.log(value)
              console.log("before break")
              if (done) {
                break;
              }
              console.log("before lines")
              // Decode chunk
              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split("\n");
              console.log("lines")
              for (const line of lines) {
                try {
                  console.log(4)
                  const jsonData = JSON.parse(line);
                  if (jsonData.response) {
                    // Append new content to existing text
                    responseText += jsonData.response;

                  }
                } catch (e) {
                  console.error("Error parsing JSON:", e);
                }
              }
            }
            messages.push({ role: "assistant", content: responseText });

            // Update conversation to KV
            try {
                console.log(5)
                await env.CHAT_HISTORY.put(`history:${userId}`, JSON.stringify(messages), {
                expirationTtl: 60 * 60 * 24 * 7, // keep 7 days by default
                });
            } catch (err) {
              console.warn("Failed to write CHAT_HISTORY:", err);
            }

          } catch (err) {
            console.warn("Error reading AI response stream:", err);
          }
        })();

        // Return the client-facing response using the client stream and original headers
        const clientHeaders = new Headers(aiResponse.headers);
        return new Response(streamForClient, {
          status: aiResponse.status,
          statusText: aiResponse.statusText,
          headers: clientHeaders,
        });
      }
  } catch (err) {
    console.warn("Failed to tee AI response stream:", err);
  }

  return aiResponse;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

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