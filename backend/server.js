const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');

// Services & Controllers
const chatDbService = require('./src/services/chatDbService');
const aiController = require('./src/controllers/aiController');
const contentController = require('./src/controllers/contentController');
const vectorController = require('./src/controllers/vectorController');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for all origins (important for browser extensions)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Setup Multer for PDF file uploads (in-memory buffer storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // Limit: 15MB
});

// --- Health Check Route ---
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'Lakshya AI Companion Backend'
  });
});

// --- Chat Conversations History Database (Local JSON / SQLite wrapper) ---
app.get('/api/conversations', async (req, res) => {
  try {
    const list = await chatDbService.getConversations();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/conversations', async (req, res) => {
  try {
    const { title, modelUsed } = req.body;
    const conv = await chatDbService.createConversation(title, modelUsed);
    res.status(201).json(conv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/conversations/:id', async (req, res) => {
  try {
    const { title } = req.body;
    const conv = await chatDbService.updateConversationTitle(req.params.id, title);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const result = await chatDbService.deleteConversation(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await chatDbService.getMessages(req.params.id);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { role, content } = req.body;
    if (!role || !content) {
      return res.status(400).json({ error: 'role and content are required' });
    }
    const message = await chatDbService.saveMessage(req.params.id, role, content);
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Content Ingestion & Vector indexing ---
app.post('/api/ingest/webpage', contentController.ingestWebpage);
app.post('/api/ingest/pdf', upload.single('file'), contentController.ingestPdf);
app.post('/api/ingest/spreadsheet', upload.single('file'), contentController.ingestSpreadsheet);

// --- AI Model & Completion Management ---
app.get('/api/models', aiController.listModels);
app.post('/api/chat', aiController.chat);

// --- Vector Operations (Direct) ---
app.post('/api/vector/search', vectorController.search);
app.post('/api/vector/clear', vectorController.clear);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Start listening
app.listen(PORT, () => {
  console.log(`LAKSHYA Backend running on port ${PORT}`);
});
