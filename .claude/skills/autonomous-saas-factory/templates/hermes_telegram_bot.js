/**
 * Zero-Dependency Asynchronous Telegram Bot Template for Node.js
 * 
 * Features:
 * - Native Node.js `fetch` (requires Node.js v18+) - no heavy frameworks like Telegraf.
 * - Long-polling loop with dynamic offset management.
 * - In-memory chat history management with sliding-window capacity limit.
 * - Integration with OpenAI-compatible API base gateways (e.g., OmniRoute, OpenRouter).
 * - System Prompt customization for specialized agent personalities.
 */

const TG_TOKEN = process.env.TG_BOT_TOKEN; // Set via env or replace
const API_BASE = process.env.API_BASE_URL || "https://omni.zhdanov.pw/v1";
const MODEL_NAME = process.env.MODEL_NAME || "gemini-cli/gemini-2.5-flash";
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "You are Hermes, a sharp, competent, slightly sarcastic AI navigator.";
const CONTEXT_LIMIT = parseInt(process.env.CONTEXT_LIMIT || "20", 10);

if (!TG_TOKEN) {
  console.error("❌ Error: TG_BOT_TOKEN is not set in environment variables!");
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const chatHistories = {}; // ChatID -> array of OpenAI-like message objects

async function sendTelegram(method, payload) {
  const url = `${TG_API}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`⚠️ Telegram API returned error for ${method}:`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`❌ Fetch error for Telegram method ${method}:`, err.message);
    return { ok: false };
  }
}

async function sendMessage(chatId, text) {
  return sendTelegram("sendMessage", {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown"
  });
}

async function sendTyping(chatId) {
  return sendTelegram("sendChatAction", {
    chat_id: chatId,
    action: "typing"
  });
}

async function getAIResponse(chatId, userMessage) {
  if (!chatHistories[chatId]) {
    chatHistories[chatId] = [];
  }

  // Append user message
  chatHistories[chatId].push({ role: "user", content: userMessage });

  // Slide window to fit inside context limits
  if (chatHistories[chatId].length > CONTEXT_LIMIT) {
    chatHistories[chatId] = chatHistories[chatId].slice(-CONTEXT_LIMIT);
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...chatHistories[chatId]
  ];

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: messages,
        stream: false
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API Gateway error (${res.status}): ${errText}`);
    }

    const result = await res.json();
    const reply = result.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error("Empty completion response from API Gateway.");
    }

    // Append AI assistant message to history
    chatHistories[chatId].push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error(`❌ AI Generation failed for Chat ${chatId}:`, err.message);
    // Remove the last user message to prevent loop/dead-ends on retries
    chatHistories[chatId].pop();
    return `⚠️ Ой, возникла техническая шоколадка на стороне ИИ-шлюза: ${err.message}`;
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  console.log(`[${chatId}] User: ${text}`);

  // System actions
  if (text === "/start" || text === "/clear") {
    chatHistories[chatId] = [];
    await sendMessage(chatId, "🧹 Привет! Моя память очищена. Я готов к новому диалогу.");
    return;
  }

  // Trigger typing indicator
  await sendTyping(chatId);

  // Generate response
  const response = await getAIResponse(chatId, text);
  await sendMessage(chatId, response);
}

async function runBot() {
  console.log("=== Starting Asynchronous Zero-Dependency Telegram Bot ===");
  console.log(`Using API Gateway Base: ${API_BASE}`);
  console.log(`Target Model: ${MODEL_NAME}`);
  
  let offset = 0;
  
  while (true) {
    try {
      const response = await fetch(`${TG_API}/getUpdates?offset=${offset}&timeout=30`);
      if (!response.ok) {
        console.warn(`⚠️ failed to get updates (HTTP ${response.status}), retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const data = await response.json();
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          try {
            await handleUpdate(update);
          } catch (updateErr) {
            console.error("❌ Error handling specific update:", updateErr);
          }
          offset = update.update_id + 1;
        }
      }
    } catch (err) {
      console.error("❌ Long-polling error, retrying in 10 seconds...", err.message);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// Global unhandled promise rejection catching to keep process alive under PM2
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});

runBot();
