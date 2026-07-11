// LAKSHYA - API Integration Layer

const BACKEND_URL = 'http://localhost:5000';

const api = {
  // Check backend server connection
  async checkStatus() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/status`);
      if (!response.ok) return false;
      const data = await response.json();
      return data.status === 'online';
    } catch {
      return false;
    }
  },

  // --- Chat Database endpoints ---
  async getConversations() {
    const res = await fetch(`${BACKEND_URL}/api/conversations`);
    if (!res.ok) throw new Error('Failed to load conversations');
    return res.json();
  },

  async createConversation(title = 'New Chat', modelUsed = '') {
    const res = await fetch(`${BACKEND_URL}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, modelUsed })
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    return res.json();
  },

  async updateConversationTitle(id, title) {
    const res = await fetch(`${BACKEND_URL}/api/conversations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    if (!res.ok) throw new Error('Failed to update title');
    return res.json();
  },

  async deleteConversation(id) {
    const res = await fetch(`${BACKEND_URL}/api/conversations/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete conversation');
    return res.json();
  },

  async getMessages(conversationId) {
    const res = await fetch(`${BACKEND_URL}/api/conversations/${conversationId}/messages`);
    if (!res.ok) throw new Error('Failed to load messages');
    return res.json();
  },

  async saveMessage(conversationId, role, content) {
    const res = await fetch(`${BACKEND_URL}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content })
    });
    if (!res.ok) throw new Error('Failed to save message');
    return res.json();
  },

  // --- Content Ingestion ---
  async ingestWebpage(text, url, title, config = {}) {
    const res = await fetch(`${BACKEND_URL}/api/ingest/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, url, title, config })
    });
    if (!res.ok) throw new Error('Failed to ingest webpage content');
    return res.json();
  },

  async ingestPdf(file, config = {}, storeInDb = false) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('config', JSON.stringify(config));

    const res = await fetch(`${BACKEND_URL}/api/ingest/pdf?store=${storeInDb}`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      let message = 'Failed to parse PDF';
      try {
        const err = await res.json();
        message = err.error || err.message || message;
      } catch {
        message = await res.text() || message;
      }
      throw new Error(message);
    }
    return res.json();
  },

  async ingestSpreadsheet(file, config = {}, storeInDb = false) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('config', JSON.stringify(config));

    const res = await fetch(`${BACKEND_URL}/api/ingest/spreadsheet?store=${storeInDb}`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      let message = 'Failed to parse spreadsheet';
      try {
        const err = await res.json();
        message = err.error || err.message || message;
      } catch {
        message = await res.text() || message;
      }
      throw new Error(message);
    }
    return res.json();
  },

  // --- AI models ---
  async getModels(config = {}) {
    const { provider = 'local', apiKey = '', lmStudioUrl = 'http://localhost:1234/v1' } = config;
    const params = new URLSearchParams({ provider, apiKey, lmStudioUrl });
    const res = await fetch(`${BACKEND_URL}/api/models?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch models');
    }
    const data = await res.json();
    return data.models;
  },

  // --- Stream Chat Response ---
  async chatStream(messages, config = {}, activeTabContext = null, fileContext = null, image = null, onChunk, onDone, onError) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, config, activeTabContext, fileContext, image })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Server completed with error status');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Retain final line if it's incomplete
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // SSE data line parsing
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6);
            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                onChunk(content);
              }
            } catch (err) {
              // Ignore partial or parsing errors in chunks
            }
          }
        }
      }

      // Flush remaining data
      if (buffer && buffer.trim().startsWith('data: ')) {
        const dataStr = buffer.trim().substring(6);
        if (dataStr !== '[DONE]') {
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) onChunk(content);
          } catch (e) {}
        }
      }

      onDone();
    } catch (error) {
      console.error('API Chat streaming failed:', error);
      onError(error);
    }
  },

  // --- Vector store ---
  async clearVectorDb() {
    const res = await fetch(`${BACKEND_URL}/api/vector/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to clear vector database');
    return res.json();
  },

  // --- Study Mode Generation ---
  async generateStudyMaterial(type, content, count = 5, config = {}, image = null, url = null) {
    const res = await fetch(`${BACKEND_URL}/api/study/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, content, count, config, image, url })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || err.message || 'Failed to generate study material');
    }
    return res.json();
  }
};

export default api;
