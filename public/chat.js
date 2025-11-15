/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const newChatButton = document.getElementById("new-chat-btn");
const chatList = document.getElementById("chat-list");

// Chat state
let userId = null;
let currentChatId = null;
let chatHistory = [];
let chats = []; // Array of { name, chatId }
let isProcessing = false;
let chatCache = {}; // Cache chat histories: { chatId: [...messages] }

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

// New chat button
if (newChatButton) {
  newChatButton.addEventListener("click", createNewChat);
}

// On page load: initialize userId and load chats
window.addEventListener("DOMContentLoaded", async () => {
  userId = getUserId();
  await loadChats();
  
  // If no chats, create one
  if (chats.length === 0) {
    await createNewChat();
  } else {
    // Load the first chat by default
    selectChat(chats[0].chatId);
  }
});

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
  const message = userInput.value.trim();

  // Don't send empty messages or if no chat selected
  if (message === "" || isProcessing || !currentChatId) return;

  // Disable input while processing
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  // Add user message to chat
  addMessageToChat("user", message);

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";

  // Show typing indicator
  typingIndicator.classList.add("visible");

  // Add message to history
  chatHistory.push({ role: "user", content: message });

  try {
    // Create new assistant response element
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    assistantMessageEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantMessageEl);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send request to API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: userId,
        chatId: currentChatId,
        messages: chatHistory,
      }),
    });

    // Handle errors
    if (!response.ok) {
      throw new Error("Failed to get response");
    }

    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let responseText = "";
    let buffer = ""; // Buffer for incomplete lines


    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Decode chunk and add to buffer
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process complete lines
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
            // Append new content to existing text
            responseText += jsonData.response;
            assistantMessageEl.querySelector("p").textContent = responseText;

            // Scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch (e) {
          console.error("Error parsing JSON:", e);
        }
      }
    }

    // Add completed response to chat history
    chatHistory.push({ role: "assistant", content: responseText });
    // Update cache with latest history
    chatCache[currentChatId] = chatHistory;
  } catch (error) {
    console.error("Error:", error);
    addMessageToChat(
      "assistant",
      "Sorry, there was an error processing your request.",
    );
  } finally {
    // Hide typing indicator
    typingIndicator.classList.remove("visible");

    // Re-enable input
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${content}</p>`;
  chatMessages.appendChild(messageEl);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatHistory() {
  // Clear
  chatMessages.innerHTML = "";
  for (const msg of chatHistory) {
    // Skip system messages - they should not be displayed to the user
    if (msg.role === "system") continue;
    addMessageToChat(msg.role, msg.content);
  }
}

// Get user ID from local storage or create one if not there
function getUserId() {
  let userId = localStorage.getItem("userId");
  if (!userId) {
    userId = crypto.randomUUID?.();
    localStorage.setItem("userId", userId);
  }
  return userId;
}

// Fetch and render chats for the current user
async function loadChats() {
  try {
    const response = await fetch(`/api/conversations?userId=${encodeURIComponent(userId)}`);
    if (response.ok) {
      const data = await response.json();
      chats = data.chats || [];
      renderChatList();
    }
  } catch (error) {
    console.error("Failed to load chats:", error);
  }
}

// Create a new chat
async function createNewChat() {
  try {
    const chatId = crypto.randomUUID?.() || String(Date.now());
    
    // Extract all numbers from existing chat names and find the first missing one
    const usedNumbers = new Set();
    for (const chat of chats) {
      const match = chat.name.match(/Chat (\d+)/);
      if (match) {
        usedNumbers.add(parseInt(match[1], 10));
      }
    }
    
    // Find first missing number starting from 1
    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }
    
    const name = `Chat ${nextNumber}`;
    
    chats.push({ name, chatId });
    renderChatList();
    selectChat(chatId);
  } catch (error) {
    console.error("Failed to create chat:", error);
  }
}

// Select a chat and render its history
async function selectChat(chatId) {
  currentChatId = chatId;
  
  // Check if chat is in cache
  if (chatCache[chatId]) {
    chatHistory = chatCache[chatId];
    renderChatList();
    renderChatHistory();
    return;
  }
  
  // Otherwise fetch from server
  try {
    const response = await fetch(
      `/api/history?userId=${encodeURIComponent(userId)}&chatId=${encodeURIComponent(chatId)}`
    );
    
    if (response.ok) {
      const data = await response.json();
      chatHistory = data.history || [];
    } else {
      chatHistory = [];
    }
  } catch (error) {
    console.error("Failed to load chat history:", error);
    chatHistory = [];
  }
  
  // If chat is empty, add default greeting
  if (chatHistory.length === 0) {
    chatHistory = [
      {
        role: "assistant",
        content:
          "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
      },
    ];
  }
  
  // Cache it for future selections
  chatCache[chatId] = chatHistory;
  
  renderChatList();
  renderChatHistory();
}

// Delete a chat
async function deleteChat(chatId) {
  try {
    await fetch(
      `/api/history?userId=${encodeURIComponent(userId)}&chatId=${encodeURIComponent(chatId)}`,
      { method: "DELETE" }
    );
    
    chats = chats.filter(c => c.chatId !== chatId);
    
    // If we deleted the current chat, select another one or create a new one if none left
    if (currentChatId === chatId) {
      if (chats.length > 0) {
        selectChat(chats[0].chatId);
      } else {
        await createNewChat();
      }
    } else {
      renderChatList();
    }
  } catch (error) {
    console.error("Failed to delete chat:", error);
  }
}

// Render the chat list in the sidebar
function renderChatList() {
  chatList.innerHTML = "";
  
  for (const chat of chats) {
    const item = document.createElement("div");
    item.className = "chat-item";
    if (chat.chatId === currentChatId) {
      item.classList.add("active");
    }
    
    item.innerHTML = `
      <span class="chat-item-name">${chat.name}</span>
      <button class="chat-item-delete" title="Delete chat">×</button>
    `;
    
    // Click to select
    item.querySelector(".chat-item-name").addEventListener("click", () => {
      selectChat(chat.chatId);
    });
    
    // Click × to delete
    item.querySelector(".chat-item-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.name}"?`)) {
        deleteChat(chat.chatId);
      }
    });
    
    chatList.appendChild(item);
  }
}