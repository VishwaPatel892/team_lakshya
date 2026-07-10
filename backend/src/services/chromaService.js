const { ChromaClient } = require('chromadb');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Chroma Client.
// Inside docker, Chroma is available at http://chroma-db:8000.
// Outside docker (local fallback), it is at http://localhost:8000.
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const client = new ChromaClient({ path: CHROMA_URL });

let pipelineInstance = null;

// Helper to rewrite localhost/127.0.0.1 to host.docker.internal inside Docker container
function resolveUrl(url) {
  if (!url) return url;
  
  let processedUrl = url.trim().replace(/\/$/, '');
  
  // Auto-append /v1 if not present in the URL
  if (!processedUrl.endsWith('/v1')) {
    processedUrl += '/v1';
  }
  
  const isDocker = process.env.CHROMA_URL && process.env.CHROMA_URL.includes('chroma-db');
  if (isDocker) {
    processedUrl = processedUrl
      .replace('://localhost', '://host.docker.internal')
      .replace('://127.0.0.1', '://host.docker.internal');
  }
  return processedUrl;
}

// Dynamic load of Transformers.js for local embeddings
async function getLocalEmbedder() {
  if (!pipelineInstance) {
    try {
      const { pipeline } = await import('@xenova/transformers');
      // Xenova/all-MiniLM-L6-v2 is a 23MB, high-quality, lightweight model
      pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('Local embedding model Xenova/all-MiniLM-L6-v2 loaded successfully.');
    } catch (err) {
      console.error('Failed to load local Transformers.js pipeline:', err);
      throw err;
    }
  }
  return pipelineInstance;
}

// Generate embeddings based on configuration
async function generateEmbedding(text, config = {}) {
  const { provider = 'local', apiKey = '', lmStudioUrl = 'http://localhost:1234/v1', model = '' } = config;
  const resolvedUrl = resolveUrl(lmStudioUrl);

  // 1. OpenAI / OpenRouter Embeddings
  if (provider === 'openrouter' && apiKey) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          input: text,
          model: 'openai/text-embedding-3-small' // Fixed: Always use a dedicated embedding model, not the chat model
        })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.data && result.data[0] && result.data[0].embedding) {
          return result.data[0].embedding;
        }
      }
      console.warn('OpenRouter embedding request failed, falling back to local embedder.');
    } catch (e) {
      console.error('Error during remote embedding generation:', e);
    }
  }

  // 2. LM Studio Embeddings
  if (provider === 'lmstudio') {
    try {
      const url = `${resolvedUrl.replace(/\/$/, '')}/embeddings`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          model: 'local-model' // Fixed: Use generic local model, not the text LLM model
        })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.data && result.data[0] && result.data[0].embedding) {
          return result.data[0].embedding;
        }
      }
      console.warn('LM Studio embedding request failed, falling back to local embedder.');
    } catch (e) {
      console.error('Error during LM Studio embedding generation:', e);
    }
  }

  // 3. Fallback to Local Transformers.js
  const extractor = await getLocalEmbedder();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Retrieve or create collection in ChromaDB
async function getOrCreateCollection(name = 'lakshya_knowledge') {
  try {
    return await client.getOrCreateCollection({ name });
  } catch (error) {
    console.error(`Error getting or creating Chroma collection: ${name}`, error);
    throw error;
  }
}

const chromaService = {
  // Add a single document to the collection (automatically chunks & embeds)
  async addDocument(text, metadata = {}, collectionName = 'lakshya_knowledge', config = {}) {
    const collection = await getOrCreateCollection(collectionName);
    
    // Chunking text: Simple sentence/paragraph chunking
    const chunks = this.chunkText(text, 1000, 200);
    console.log(`Document chunked into ${chunks.length} chunks.`);

    const ids = [];
    const embeddings = [];
    const metadatas = [];
    const documents = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = `${metadata.source || 'doc'}_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`;
      
      try {
        const embedding = await generateEmbedding(chunk, config);
        ids.push(chunkId);
        embeddings.push(embedding);
        metadatas.push({
          ...metadata,
          chunkIndex: i,
          totalChunks: chunks.length,
          timestamp: new Date().toISOString()
        });
        documents.push(chunk);
      } catch (err) {
        console.error(`Failed to generate embedding for chunk ${i}:`, err);
      }
    }

    if (ids.length > 0) {
      await collection.add({
        ids,
        embeddings,
        metadatas,
        documents
      });
      console.log(`Added ${ids.length} chunks to Chroma collection: ${collectionName}`);
    }

    return { success: true, chunksAdded: ids.length };
  },

  // Query database for semantically similar documents
  async queryKnowledge(queryText, limit = 3, collectionName = 'lakshya_knowledge', config = {}) {
    try {
      const collection = await getOrCreateCollection(collectionName);
      const queryEmbedding = await generateEmbedding(queryText, config);

      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit
      });

      // Format results for system prompt injection
      const formattedResults = [];
      if (results && results.documents && results.documents[0]) {
        for (let i = 0; i < results.documents[0].length; i++) {
          formattedResults.push({
            content: results.documents[0][i],
            metadata: results.metadatas[0][i],
            distance: results.distances ? results.distances[0][i] : null
          });
        }
      }
      return formattedResults;
    } catch (error) {
      console.error('Error querying ChromaDB:', error);
      return [];
    }
  },

  // Clear knowledge base
  async clearKnowledge(collectionName = 'lakshya_knowledge') {
    try {
      await client.deleteCollection({ name: collectionName });
      await getOrCreateCollection(collectionName);
      return { success: true };
    } catch (error) {
      console.error('Error clearing Chroma collection:', error);
      return { success: false, error: error.message };
    }
  },

  // Utility to split text into overlapping chunks
  chunkText(text, chunkSize = 1000, chunkOverlap = 200) {
    if (!text) return [];
    const chunks = [];
    let index = 0;

    while (index < text.length) {
      // Find a clean break point (like a newline or space) near target chunk size
      let end = index + chunkSize;
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const breakPoint = Math.max(lastSpace, lastNewline);
        if (breakPoint > index + chunkSize / 2) {
          end = breakPoint;
        }
      } else {
        end = text.length;
      }

      chunks.push(text.slice(index, end).trim());
      index = end - chunkOverlap;
      
      // Prevent infinite loop if chunkOverlap is >= chunkSize or progress stalls
      if (index >= end) {
        index = end;
      }
    }

    return chunks.filter(c => c.length > 10); // Remove tiny junk chunks
  }
};

module.exports = chromaService;
