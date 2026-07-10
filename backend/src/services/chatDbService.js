const fs = require('fs').promises;
const path = require('path');

const DB_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Initialize database with default schema
async function initDb() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    try {
      await fs.access(DB_FILE);
    } catch {
      const defaultSchema = {
        conversations: [],
        messages: []
      };
      await fs.writeFile(DB_FILE, JSON.stringify(defaultSchema, null, 2), 'utf8');
      console.log('Database file initialized at:', DB_FILE);
    }
  } catch (error) {
    console.error('Failed to initialize local database:', error);
  }
}

// Read database contents
async function readDb() {
  try {
    await initDb();
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error);
    return { conversations: [], messages: [] };
  }
}

// Write database contents
async function writeDb(data) {
  try {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing to database:', error);
  }
}

const chatDbService = {
  // Get all conversations (sorted by latest)
  async getConversations() {
    const db = await readDb();
    return db.conversations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // Create a new conversation
  async createConversation(title = 'New Chat', modelUsed = '') {
    const db = await readDb();
    const newConv = {
      id: 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      title,
      modelUsed,
      createdAt: new Date().toISOString()
    };
    db.conversations.push(newConv);
    await writeDb(db);
    return newConv;
  },

  // Update conversation title
  async updateConversationTitle(id, title) {
    const db = await readDb();
    const conv = db.conversations.find(c => c.id === id);
    if (conv) {
      conv.title = title;
      await writeDb(db);
    }
    return conv;
  },

  // Delete a conversation and all its messages
  async deleteConversation(id) {
    const db = await readDb();
    db.conversations = db.conversations.filter(c => c.id !== id);
    db.messages = db.messages.filter(m => m.conversationId !== id);
    await writeDb(db);
    return { success: true };
  },

  // Get messages for a specific conversation
  async getMessages(conversationId) {
    const db = await readDb();
    return db.messages
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  // Save a message
  async saveMessage(conversationId, role, content) {
    const db = await readDb();
    
    // Auto-create conversation if it doesn't exist
    let conv = db.conversations.find(c => c.id === conversationId);
    if (!conv && conversationId) {
      conv = {
        id: conversationId,
        title: content.substring(0, 30) + (content.length > 30 ? '...' : ''),
        modelUsed: 'unknown',
        createdAt: new Date().toISOString()
      };
      db.conversations.push(conv);
    }

    const newMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      conversationId,
      role, // 'user' or 'assistant'
      content,
      timestamp: new Date().toISOString()
    };
    db.messages.push(newMessage);

    // If it's the first user message, update conversation title automatically
    if (conv && role === 'user') {
      const userMsgs = db.messages.filter(m => m.conversationId === conversationId && m.role === 'user');
      if (userMsgs.length === 1) {
        conv.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      }
    }

    await writeDb(db);
    return newMessage;
  }
};

module.exports = chatDbService;
