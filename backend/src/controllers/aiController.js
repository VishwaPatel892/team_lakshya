const llmService = require('../services/llmService');
const chromaService = require('../services/chromaService');

const aiController = {
  // Fetch available models from selected provider
  async listModels(req, res) {
    const { provider, apiKey, lmStudioUrl } = req.query;

    try {
      const models = await llmService.getModels({ provider, apiKey, lmStudioUrl });
      return res.json({ models });
    } catch (error) {
      console.error('List models failed:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // Perform streaming completion with vector DB context injection (RAG) and/or active file context
  async chat(req, res) {
    const { messages, config = {}, activeTabContext = null, fileContext = null, image = null } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    try {
      let systemPrompt = config.systemPrompt || 'You are LAKSHYA, an intelligent AI Browser Companion. Assist the user with page reading, text summarization, explanation, and natural conversations.';
      
      // 1. Inject active webpage context if available
      if (activeTabContext && activeTabContext.url) {
        console.log(`Injecting active page context: "${activeTabContext.title}" (${activeTabContext.url})`);
        systemPrompt += `\n\n[CURRENT ACTIVE WEBPAGE CONTEXT]
You are helping the user with the webpage they are currently viewing:
Title: "${activeTabContext.title || 'Untitled'}"
URL: ${activeTabContext.url}

Visible webpage text content:
"""
${activeTabContext.text || '(No text content extracted)'}
"""
Rely on this active page context to answer queries referring to "this page", "what I am seeing", "this website", "this content", "summarize", etc.
[END OF CURRENT ACTIVE WEBPAGE CONTEXT]`;
      }
      
      // 2. Inject active document file context if available (Memory / Session mode)
      if (fileContext && fileContext.text) {
        console.log(`Injecting session file context: "${fileContext.title || 'Uploaded Document'}" (${fileContext.text.length} chars)`);
        systemPrompt += `\n\n[UPLOADED DOCUMENT CONTEXT]
You have access to the contents of the user's uploaded document "${fileContext.title || 'document'}":
"""
${fileContext.text}
"""
Refer primarily to this document context to answer questions about the file.
[END OF UPLOADED DOCUMENT CONTEXT]`;
      }
      
      // Inject context from Vector DB if RAG is enabled
      if (config.ragEnabled) {
        // Find the last user message to query semantic search
        const userMessages = messages.filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];

        if (lastUserMessage) {
          console.log(`RAG Enabled: Querying ChromaDB for context matching: "${lastUserMessage.content.substring(0, 50)}..."`);
          
          const contextChunks = await chromaService.queryKnowledge(
            lastUserMessage.content,
            3,
            'lakshya_knowledge',
            config
          );

          if (contextChunks && contextChunks.length > 0) {
            const contextText = contextChunks
              .map(chunk => `[Source: ${chunk.metadata.title || chunk.metadata.source} (${chunk.metadata.url || 'local'})]\n${chunk.content}`)
              .join('\n\n');

            systemPrompt += `\n\n[CONTEXT INFORMATION]\nUse the following extracted webpage/document context to help answer the user's query. Rely primarily on this content for facts. If this context is not helpful or relevant, reply using your general knowledge but note the context did not contain relevant details.\n\n${contextText}\n[END OF CONTEXT INFORMATION]`;
            console.log(`Injected ${contextChunks.length} matching context chunks into LLM prompt.`);
          } else {
            console.log('RAG Enabled but no matching context was found in ChromaDB.');
          }
        }
      }

      // 3. Inject image attachment context if available (multimodal input for vision models)
      if (image) {
        console.log('Multimodal query: injecting image Base64 data url into last user message.');
        const userMessages = messages.filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];
        
        if (lastUserMessage) {
          if (Array.isArray(lastUserMessage.content)) {
            lastUserMessage.content.push({
              type: 'image_url',
              image_url: { url: image }
            });
          } else {
            const lastMessageText = lastUserMessage.content;
            lastUserMessage.content = [
              { type: 'text', text: lastMessageText || 'Describe this image' },
              { type: 'image_url', image_url: { url: image } }
            ];
          }
        }
      }

      // Execute stream response
      await llmService.streamChatCompletion(
        messages, 
        { ...config, systemPrompt }, 
        res
      );

    } catch (error) {
      console.error('Chat controller failed:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message });
      }
    }
  },

  // Generate structured study materials strictly from source content
  async generateStudyMaterial(req, res) {
    const { type, content, count = 5, config = {}, image = null } = req.body;

    if ((!content || !content.trim()) && !image) {
      return res.status(400).json({ error: 'No webpage or document content found. Please use Read Page Content or upload a document first.' });
    }

    try {
      let prompt = '';
      if (type === 'quiz') {
        prompt = `Generate a quiz with exactly ${count} multiple-choice questions based ONLY on the supplied source text.
CRITICAL RULES:
- Do NOT use prior knowledge.
- Do NOT use general internet knowledge.
- Do NOT hallucinate.
- Do NOT create assumptions.
- Use ONLY the supplied content. Every question must be fully supported by facts explicitly stated in the source text.
- If the source text does not contain enough information to generate ${count} accurate questions, generate only the maximum possible number of accurate questions based on the source text (even if it is 0, 1, or 2), and set the "limitedInfoNotice" field to: "Only X questions could be generated because the provided content contains limited information." (where X is the number of questions actually generated). Otherwise, leave "limitedInfoNotice" as null or empty.
- Do NOT create fake questions just to reach the requested count.
- Respond with a valid JSON object matching this structure EXACTLY. Ensure the output is strictly a parseable JSON object with no markdown wrappers or additional text:
{
  "limitedInfoNotice": "Only X questions could be generated because the provided content contains limited information." (or null if target count met),
  "questions": [
    {
      "question": "question text",
      "options": ["option A", "option B", "option C", "option D"],
      "answer": "the exact string of the correct option",
      "explanation": "why this option is correct based ONLY on the text"
    }
  ]
}`;
      } else if (type === 'flashcards') {
        prompt = `Generate a list of flashcards (maximum ${count}) based ONLY on the concepts explicitly mentioned in the supplied source text.
CRITICAL RULES:
- Do NOT use prior knowledge or outside context.
- Flashcards must contain key terms or questions on the front, and definitions or answers on the back, derived strictly from the text.
- Respond with a valid JSON array matching this structure EXACTLY. Ensure the output is strictly a parseable JSON array with no markdown wrappers or additional text:
[
  {
    "front": "concept or question",
    "back": "explanation or definition based strictly on the text"
  }
]`;
      } else if (type === 'notes') {
        prompt = `Summarize and generate study notes based ONLY on the provided text.
CRITICAL RULES:
- Rely ONLY on the provided text. Summarize only what is explicitly stated.
- Do NOT add extra explanations, external background, or outside knowledge not supported by the source.
- Respond with a valid JSON object matching this structure EXACTLY. Ensure the output is strictly a parseable JSON object with no markdown wrappers or additional text:
{
  "summary": "a comprehensive structured summary of the text in markdown format",
  "keyPoints": [
    "important point 1 from text",
    "important point 2 from text"
  ]
}`;
      } else if (type === 'viva' || type === 'interview') {
        prompt = `Generate a list of exactly ${count} ${type} questions and answers based ONLY on the provided text.
CRITICAL RULES:
- Do NOT use prior knowledge or external details. Questions must focus on concepts explicitly found in the source material.
- If the source does not contain enough information to generate ${count} accurate questions, generate only the maximum possible number of accurate questions based on the source text, and set "limitedInfoNotice" to: "Only X questions could be generated because the provided content contains limited information." (where X is the number of questions generated). Otherwise, leave "limitedInfoNotice" as null or empty.
- Do NOT create fake questions just to reach the requested count.
- Respond with a valid JSON object matching this structure EXACTLY. Ensure the output is strictly a parseable JSON object with no markdown wrappers or additional text:
{
  "limitedInfoNotice": "Only X questions could be generated because the provided content contains limited information." (or null if target count met),
  "questions": [
    {
      "question": "question text",
      "answer": "answer text based strictly on the provided material"
    }
  ]
}`;
      } else {
        return res.status(400).json({ error: 'Invalid study material type' });
      }

      const messages = [
        { role: 'user', content: image ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } }
        ] : `${prompt}\n\nSource Text:\n"""\n${content}\n"""` }
      ];

      const systemPrompt = `You are a helpful study companion. You must output raw JSON only. Do not write any markdown codeblocks, notes, or preamble outside the JSON. All JSON fields must be populated based strictly on the provided source content.`;

      const rawResult = await llmService.getChatCompletion(
        messages,
        { ...config, systemPrompt }
      );

      // Try parsing JSON, stripping markdown codeblocks if LLM included them
      let parsedData;
      try {
        let cleanJsonStr = rawResult.trim();
        if (cleanJsonStr.startsWith('```')) {
          cleanJsonStr = cleanJsonStr.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
        }
        parsedData = JSON.parse(cleanJsonStr.trim());
      } catch (err) {
        console.warn('Failed to parse LLM JSON directly. Raw result was:', rawResult);
        const jsonMatch = rawResult.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
          parsedData = JSON.parse(jsonMatch[0].trim());
        } else {
          throw err;
        }
      }

      return res.json(parsedData);

    } catch (error) {
      console.error('Study material generation failed:', error);
      return res.status(500).json({ error: 'Failed to generate study material: ' + error.message });
    }
  }
};

module.exports = aiController;
