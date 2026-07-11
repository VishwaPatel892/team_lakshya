const dotenv = require('dotenv');

dotenv.config();

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

const llmService = {
  // Fetch available models from local LM Studio or OpenRouter
  async getModels(providerConfig) {
    const { provider = 'local', apiKey = '', lmStudioUrl = 'http://localhost:1234/v1' } = providerConfig;
    const resolvedUrl = resolveUrl(lmStudioUrl);

    if (provider === 'openrouter') {
      if (!apiKey) {
        throw new Error('OpenRouter API key is required');
      }
      try {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://github.com/lakshya/browser-companion',
            'X-Title': 'Lakshya AI Companion'
          }
        });
        if (!response.ok) {
          const err = await response.text();
          throw new Error(`OpenRouter returned error: ${err}`);
        }
        const data = await response.json();
        return data.data.map(m => ({
          id: m.id,
          name: m.name || m.id,
          contextLength: m.context_length
        }));
      } catch (error) {
        console.error('Error fetching OpenRouter models:', error);
        throw error;
      }
    } else {
      // LM Studio local models
      try {
        const url = `${resolvedUrl.replace(/\/$/, '')}/models`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`LM Studio returned error status: ${response.status}`);
        }
        const data = await response.json();
        return data.data.map(m => ({
          id: m.id,
          name: m.id,
          contextLength: 2048 // Default fallback
        }));
      } catch (error) {
        console.error('Error fetching LM Studio models:', error);
        throw new Error(`Unable to reach local LM Studio at ${lmStudioUrl}. Ensure LM Studio server is running.`);
      }
    }
  },

  // Perform streaming completion and pipe to express response object
  async streamChatCompletion(messages, providerConfig, res) {
    const { 
      provider = 'local', 
      apiKey = '', 
      lmStudioUrl = 'http://localhost:1234/v1', 
      model = '', 
      systemPrompt = '' 
    } = providerConfig;
    
    const resolvedUrl = resolveUrl(lmStudioUrl);

    let targetUrl = '';
    const headers = { 'Content-Type': 'application/json' };

    // Format prompt messages
    const formattedMessages = [...messages];
    
    // Inject system prompt if present and not already at index 0
    if (systemPrompt && (!formattedMessages[0] || formattedMessages[0].role !== 'system')) {
      formattedMessages.unshift({ role: 'system', content: systemPrompt });
    }

    if (provider === 'openrouter') {
      if (!apiKey) {
        res.status(400).json({ error: 'OpenRouter API key is required.' });
        return;
      }
      targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = 'https://github.com/lakshya/browser-companion';
      headers['X-Title'] = 'Lakshya AI Companion';
    } else {
      targetUrl = `${resolvedUrl.replace(/\/$/, '')}/chat/completions`;
    }

    const payload = {
      model: model || (provider === 'openrouter' ? 'meta-llama/llama-3-8b-instruct:free' : 'local-model'),
      messages: formattedMessages,
      stream: true
    };

    console.log(`Sending streaming prompt to ${provider} using model: ${payload.model}`);

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`LLM API returned error: ${response.status}`, errorText);
        res.status(response.status).json({ error: `LLM service error: ${errorText}` });
        return;
      }

      // Configure headers for EventStream / SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Save the last incomplete line back into the buffer
        buffer = lines.pop();

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (cleanedLine === '') continue;
          
          // Send raw SSE stream directly to the client
          res.write(`${line}\n`);
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        res.write(`${buffer}\n`);
      }
      
      res.end();
    } catch (error) {
      console.error('Streaming completion failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to complete chat stream: ${error.message}` });
      } else {
        res.end();
      }
    }
  },

  // Perform non-streaming completion for structured JSON
  async getChatCompletion(messages, providerConfig) {
    const { 
      provider = 'local', 
      apiKey = '', 
      lmStudioUrl = 'http://localhost:1234/v1', 
      model = '', 
      systemPrompt = '' 
    } = providerConfig;
    
    const resolvedUrl = resolveUrl(lmStudioUrl);
    let targetUrl = '';
    const headers = { 'Content-Type': 'application/json' };

    const formattedMessages = [...messages];
    if (systemPrompt && (!formattedMessages[0] || formattedMessages[0].role !== 'system')) {
      formattedMessages.unshift({ role: 'system', content: systemPrompt });
    }

    if (provider === 'openrouter') {
      if (!apiKey) {
        throw new Error('OpenRouter API key is required');
      }
      targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = 'https://github.com/lakshya/browser-companion';
      headers['X-Title'] = 'Lakshya AI Companion';
    } else {
      targetUrl = `${resolvedUrl.replace(/\/$/, '')}/chat/completions`;
    }

    const payload = {
      model: model || (provider === 'openrouter' ? 'meta-llama/llama-3-8b-instruct:free' : 'local-model'),
      messages: formattedMessages,
      stream: false
    };

    console.log(`Sending non-streaming completion request to ${provider} using model: ${payload.model}`);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM service returned error: ${err}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response structure from LLM service');
    }
    return data.choices[0].message.content;
  }
};

module.exports = llmService;
