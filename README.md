# Cloudflare AI Chat App

A multi-chat LLM application powered by **Cloudflare Workers AI** with persistent cloud storage using **Cloudflare KV**.

**Live Demo**: https://cf-ai-taskcoach.geroau.workers.dev/

## Features

- **Multiple Chats** - Create, switch, and manage multiple conversations
- **Cloud Storage** - All chats persist in Cloudflare KV namespace
- **Streaming Responses** - Real-time AI responses 
- **Chat Caching** - In-memory cache for fast switching between chats
- **Delete Chats** - Remove unwanted conversations
- **System Prompts** - Configurable AI behavior with hidden system messages

## Tech Stack

- **Runtime**: Cloudflare Workers (TypeScript)
- **AI Model**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Storage**: Cloudflare KV Namespace
- **Frontend**: Vanilla JavaScript, HTML, CSS


## Project Structure

```
cf-ai-taskcoach/
├── src/
│   ├── index.ts          # Worker request handler & API endpoints
│   └── types.ts          # TypeScript interfaces
├── public/
│   ├── index.html        # Frontend UI
│   └── chat.js           # Chat logic & API calls
├── wrangler.jsonc        # Cloudflare configuration
├── tsconfig.json         # TypeScript config
└── package.json          # Dependencies
```

## Setup

### Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g @cloudflare/wrangler`
- Cloudflare account

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Estanislao-Oviedo/cf-ai-taskcoach
cd cf-ai-taskcoach
```

2. Install dependencies:
```bash
npm install
```

3. Authenticate with Cloudflare:
```bash
wrangler login
```

4. Create a KV namespace:
```bash
wrangler kv:namespace create "CHAT_HISTORY"
```

Update `wrangler.jsonc` with the namespace ID from the output.

5. Start development server:
```bash
npm run dev
```

The app will be available at `http://localhost:8787`

## API Endpoints

### GET `/api/history?userId=<userId>&chatId=<chatId>`
Retrieve chat history for a specific chat.

**Response:**
```json
{
  "history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ]
}
```

### POST `/api/chat`
Send a message and get AI response stream.

**Request:**
```json
{
  "userId": "user-uuid",
  "chatId": "chat-uuid",
  "messages": [
    { "role": "user", "content": "What is 2+2?" }
  ]
}
```

### GET `/api/conversations?userId=<userId>`
Get all chats for a user.

**Response:**
```json
{
  "chats": [
    { "chatId": "uuid-1", "name": "Chat 1" },
    { "chatId": "uuid-2", "name": "Chat 2" }
  ]
}
```

### DELETE `/api/history?userId=<userId>&chatId=<chatId>`
Delete a chat.

**Response:**
```json
{ "message": "Chat deleted" }
```

## Development

### Build TypeScript:
```bash
npm run check
```

### Deploy to Cloudflare:
```bash
npm run deploy
```

### Monitor logs:
```bash
wrangler tail
```

## How It Works

### Chat Creation
1. User clicks "+" button to create new chat
2. Frontend generates unique `chatId` (UUID)
3. Chat name auto-increments: finds first missing number (Chat 1, Chat 2, etc.)
4. New chat added to sidebar and selected

### Chat Persistence
1. User sends message → POST `/api/chat`
2. Worker retrieves chat history from KV
3. AI generates response and sends stream
4. Worker saves updated history to KV with 7-day epiration
5. System prompt is stored but hidden from UI

### Chat Switching
1. User clicks chat in sidebar
2. Frontend checks `chatCache` for instant load
3. If not cached, fetches from `/api/history`
4. Chat messages render on screen

### Error Handling
- Missing parameters → 400 Bad Request
- KV read/write failures → 500 Internal Server Error
- Failed message processing → User-friendly error message in chat

## Configuration

Edit `src/index.ts` to change:

```typescript
// AI Model
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// System prompt (hidden from users)
const SYSTEM_PROMPT = "You are a helpful, friendly assistant...";
```

Edit `public/chat.js` to adjust:
- Cache behavior
- Message display
- Error messages

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)

## License

MIT
