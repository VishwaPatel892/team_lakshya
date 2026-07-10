const chromaService = require('../services/chromaService');

const vectorController = {
  // Search ChromaDB for relevant content
  async search(req, res) {
    const { queryText, limit = 3, collectionName = 'lakshya_knowledge', config = {} } = req.body;

    if (!queryText) {
      return res.status(400).json({ error: 'queryText is required' });
    }

    try {
      const results = await chromaService.queryKnowledge(queryText, limit, collectionName, config);
      return res.json({ results });
    } catch (error) {
      console.error('Vector search endpoint failed:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // Clear Vector Database
  async clear(req, res) {
    const { collectionName = 'lakshya_knowledge' } = req.body;
    try {
      const result = await chromaService.clearKnowledge(collectionName);
      return res.json(result);
    } catch (error) {
      console.error('Clear collection failed:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};

module.exports = vectorController;
