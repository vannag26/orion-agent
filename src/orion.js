const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();
const http      = require('http');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID);
const VDG_GATEWAY_URL = process.env.VDG_GATEWAY_URL || 'http://localhost:3099/v1';
const VDG_INTERNAL_KEY = process.env.VDG_INTERNAL_KEY || 'vdg_internal_2026';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-4-6';
const VDG_DATA_DIR = process.env.VDG_DATA_DIR || '/tmp/vdg-data';

const CONVERSATION_FILE = path.join(VDG_DATA_DIR, 'orion_conversations.json');
const MEMORY_FILE = path.join(VDG_DATA_DIR, 'memory.json');

const ORION_SYSTEM_PROMPT = `You are Orion â V&DG Management LLC's CTO and CISO. Your role: all technology infrastructure, deployments, security, API integrations, system architecture, and technical operations. You serve Vanna Gonzalez (Chairman). V&DG tech stack: Node.js bots (Leo, Nova, Atlas, Themis, Orion) on Render, VDG Internal AI Gateway (Express proxy to Anthropic), RateWire FX API, Soul Resonance Navigator (Base44/Vercel/Supabase), Vibe Travel Stack. You have 3 sub-agents: ORION-ASSISTANT, DEVOPS-AGENT, BACKEND-AGENT. Security protocol: never expose credentials, flag suspicious activity to Vanna immediately. Be technically precise, give exact commands/configs when relevant.`;

// Ensure VDG_DATA_DIR exists
fs.ensureDirSync(VDG_DATA_DIR);

// Auth middleware
bot.use((ctx, next) => {
  if (ctx.from.id !== ALLOWED_USER_ID) {
    return ctx.reply('Unauthorized');
  }
  return next();
});

// Load conversation history
async function loadConversationHistory(userId) {
  try {
    if (await fs.pathExists(CONVERSATION_FILE)) {
      const data = await fs.readJson(CONVERSATION_FILE);
      return data[userId] || [];
    }
  } catch (error) {
    console.error('Error loading conversation history:', error);
  }
  return [];
}

// Save conversation history
async function saveConversationHistory(userId, history) {
  try {
    let data = {};
    if (await fs.pathExists(CONVERSATION_FILE)) {
      data = await fs.readJson(CONVERSATION_FILE);
    }
    data[userId] = history.slice(-50); // Keep last 50 messages
    await fs.writeJson(CONVERSATION_FILE, data);
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }
}

// Load shared memory for context
async function loadSharedMemory() {
  try {
    if (await fs.pathExists(MEMORY_FILE)) {
      return await fs.readJson(MEMORY_FILE);
    }
  } catch (error) {
    console.error('Error loading shared memory:', error);
  }
  return {};
}

// Call Claude via VDG Internal AI Gateway
async function callClaude(messages, systemPrompt) {
  try {
    const response = await axios.post(`${VDG_GATEWAY_URL}/ai/chat`, {
      model: DEFAULT_MODEL,
      system: systemPrompt,
      messages,
      max_tokens: 4096
    }, {
      headers: {
        'Authorization': `Bearer ${VDG_INTERNAL_KEY}`,
        'x-vdg-product': 'orion'
      }
    });

    return response.data.content[0].text || 'No response received';
  } catch (error) {
    console.error('Error calling Claude:', error.message);
    throw error;
  }
}

// /start command
bot.command('start', async (ctx) => {
  const greeting = `Welcome to Orion â V&DG Management LLC's CTO and CISO.

I handle:
- Technology infrastructure & deployments
- Security & API integrations
- System architecture & technical ops
- 3 sub-agents: ORION-ASSISTANT, DEVOPS-AGENT, BACKEND-AGENT

Tech Stack:
- Node.js bots (Leo, Nova, Atlas, Themis, Orion) on Render
- VDG Internal AI Gateway (Express proxy to Anthropic)
- RateWire FX API
- Soul Resonance Navigator (Base44/Vercel/Supabase)
- Vibe Travel Stack

Security: Never exposing credentials, flagging suspicious activity immediately.`;
  await ctx.reply(greeting);
});

// /clear command
bot.command('clear', async (ctx) => {
  await saveConversationHistory(ctx.from.id, []);
  await ctx.reply('Conversation history cleared.');
});

// /status command
bot.command('status', async (ctx) => {
  const status = `Orion is live and operational.

Role: CTO and CISO
Current Model: ${DEFAULT_MODEL}
Status: Ready for technical consultation
Sub-agents: ORION-ASSISTANT, DEVOPS-AGENT, BACKEND-AGENT`;
  await ctx.reply(status);
});

// Message handler
bot.on('message', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;

    // Load conversation history
    let history = await loadConversationHistory(userId);

    // Load shared memory for context
    const memory = await loadSharedMemory();
    const memoryContext = Object.keys(memory).length > 0
      ? `\n\n[Shared Organization Memory]\n${JSON.stringify(memory, null, 2)}`
      : '';

    // Add user message to history
    history.push({
      role: 'user',
      content: userMessage + memoryContext
    });

    // Show typing indicator
    await ctx.sendChatAction('typing');

    // Call Claude
    const response = await callClaude(history, ORION_SYSTEM_PROMPT);

    // Add assistant response to history
    history.push({
      role: 'assistant',
      content: response
    });

    // Save updated history
    await saveConversationHistory(userId, history);

    // Reply to user (chunk if necessary)
    if (response.length > 4096) {
      const chunks = response.match(/[\s\S]{1,4096}/g) || [];
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    await ctx.reply('An error occurred while processing your request. Please try again.');
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Launch bot

// ── Launch ────────────────────────────────────────────────────────────────────
// Keepalive HTTP server required by Render Web Service (port binding)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Orion is alive')).listen(PORT, () => {
  console.log('keepalive server on :' + PORT);
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || ('localhost:' + PORT);
  const isLocal = host.startsWith('localhost');
  const pinger = isLocal ? http : require('https');
  setInterval(() => {
    const url = (isLocal ? 'http://' : 'https://') + host + '/';
    pinger.get(url, (r) => console.log('keep-alive: ' + r.statusCode)).on('error', (e) => console.log('keep-alive err: ' + e.message));
  }, 840000);
});

async function launchBot(attempt = 1) {
  if (attempt > 1) {
    const wait = attempt * 8000;
    console.log('Retry attempt ' + attempt + ', waiting ' + (wait/1000) + 's...');
    await new Promise(r => setTimeout(r, wait));
  }
  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log('Orion bot is running...');
  } catch (error) {
    if (error.message && error.message.includes('409') && attempt < 6) {
      console.log('409 conflict, retrying...');
      return launchBot(attempt + 1);
    }
    console.error('Failed to launch Orion bot:', error.message);
    // No process.exit — keepalive server stays up
  }
}
launchBot();
