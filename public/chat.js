/**
 * LLM Chat App Frontend - FIXED
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [];
let isProcessing = false;

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

// On page load fetch chat history and render
window.addEventListener("DOMContentLoaded", async () => {
  const userId = getUserId();
  try {
    const res = await fetch(`/api/history?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.history) && data.history.length) {
        chatHistory = data.history;
        renderChatHistory();
        return;
      }
    }
  } catch (e) {
    console.warn("Failed to load chat history:", e);
  }

  // No history -> seed with default assistant greeting
  chatHistory = [
    {
      role: "assistant",
      content:
        "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
    },
  ];
  renderChatHistory();
});

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
  const userId = getUserId();
  const message = userInput.value.trim();

  // Don't send empty messages
  if (message === "" || isProcessing) return;

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
      buffer += decoder.decode(value, { stream: true });

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
          console.error("Error parsing JSON:", e, "Line:", line);
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
          assistantMessageEl.querySelector("p").textContent = responseText;
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      } catch (e) {
        // Ignore
      }
    }

    // Add completed response to chat history
    chatHistory.push({ role: "assistant", content: responseText });
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