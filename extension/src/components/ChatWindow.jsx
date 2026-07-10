import React, { useRef, useEffect, useState } from 'react';
import { Bot, User, Volume2 } from 'lucide-react';
import voice from '../utils/voice';

// Lightweight, secure local Markdown Parser (Supports lists, tables, and code blocks)
function parseMarkdown(text) {
  if (!text) return '';
  
  // Escape HTML tags to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code Blocks: ```lang\ncode\n```
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let codeBlocks = [];
  html = html.replace(codeBlockRegex, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang, code });
    return placeholder;
  });

  // Inline Code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Process list elements and tables line by line
  const lines = html.split('\n');
  let inList = false;
  let inNumList = false;
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if it's a table row: starts and ends with |
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    
    if (isTableRow) {
      // Close any open lists
      let listClosePrefix = '';
      if (inList) { listClosePrefix = '</ul>'; inList = false; }
      if (inNumList) { listClosePrefix = '</ol>'; inNumList = false; }
      
      const cells = line.split('|').map(c => c.trim()).slice(1, -1);
      const isSeparator = cells.every(c => /^:?-+:?$/.test(c));
      
      if (isSeparator) {
        lines[i] = '';
        continue;
      }
      
      if (!inTable) {
        inTable = true;
        lines[i] = listClosePrefix + '<div class="table-container"><table class="chat-table"><thead><tr>' + 
          cells.map(c => `<th>${c}</th>`).join('') + 
          '</tr></thead><tbody>';
      } else {
        lines[i] = '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
      }
    } else {
      // Close open table if we step out of it
      let tableClosePrefix = '';
      if (inTable) {
        tableClosePrefix = '</tbody></table></div>';
        inTable = false;
      }
      
      // Bullet list: * item
      if (line.match(/^(\s*)[*-]\s+(.+)/)) {
        let content = line.replace(/^(\s*)[*-]\s+/, '');
        let prefix = '';
        if (!inList) {
          prefix = '<ul class="chat-list">';
          inList = true;
        }
        lines[i] = tableClosePrefix + prefix + `<li>${content}</li>`;
      } 
      // Numbered list: 1. item
      else if (line.match(/^(\s*)\d+\.\s+(.+)/)) {
        let content = line.replace(/^(\s*)\d+\.\s+/, '');
        let prefix = '';
        if (!inNumList) {
          prefix = '<ol class="chat-num-list">';
          inNumList = true;
        }
        lines[i] = tableClosePrefix + prefix + `<li>${content}</li>`;
      } 
      // Headings: #, ##, ###...
      else if (line.match(/^#{1,6}\s+(.+)/)) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        const level = Math.min(headingMatch[1].length, 3);
        let suffix = '';
        if (inList) { suffix = '</ul>'; inList = false; }
        if (inNumList) { suffix = '</ol>'; inNumList = false; }
        lines[i] = tableClosePrefix + suffix + `<h${level} class="chat-heading chat-heading-${level}">${headingMatch[2]}</h${level}>`;
      }
      else {
        let suffix = '';
        if (inList) { suffix = '</ul>'; inList = false; }
        if (inNumList) { suffix = '</ol>'; inNumList = false; }
        lines[i] = tableClosePrefix + suffix + line;
      }
    }
  }
  
  html = lines.join('\n');
  if (inTable) {
    html += '</tbody></table></div>';
  }
  
  // Replace code block placeholders with styled layout & copy actions
  codeBlocks.forEach((block, index) => {
    const escapedCode = block.code.trim();
    const uniqueId = `copy_target_${Date.now()}_${index}`;
    
    const blockHtml = `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span>${block.lang || 'code'}</span>
          <button class="copy-code-btn" data-target-id="${uniqueId}">Copy</button>
        </div>
        <pre class="code-pre"><code id="${uniqueId}">${escapedCode}</code></pre>
      </div>
    `;
    html = html.replace(`__CODE_BLOCK_${index}__`, blockHtml);
  });

  // Convert double newlines to paragraph tags, single to br
  return html.replace(/\n\n/g, '<p></p>').replace(/\n/g, '<br />');
}

export default function ChatWindow({ messages, isStreaming, settingsConfig }) {
  const containerRef = useRef(null);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);

  // Auto-scroll on new message content
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Handle code-block copy button clicks using Event Delegation
  const handleContainerClick = (e) => {
    if (e.target.classList.contains('copy-code-btn')) {
      const targetId = e.target.getAttribute('data-target-id');
      const codeEl = document.getElementById(targetId);
      
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.innerText)
          .then(() => {
            const originalText = e.target.innerText;
            e.target.innerText = 'Copied!';
            e.target.classList.add('copied');
            
            setTimeout(() => {
              e.target.innerText = originalText;
              e.target.classList.remove('copied');
            }, 2000);
          })
          .catch(err => console.error('Failed to copy code:', err));
      }
    }
  };

  // Speaks aloud the specific message text
  const handleReadMessage = (messageId, text) => {
    if (speakingMessageId === messageId) {
      voice.stopSpeaking();
      setSpeakingMessageId(null);
      return;
    }

    voice.stopSpeaking();
    voice.speak(
      text,
      {
        useExternalVoice: settingsConfig.useExternalVoice,
        apiKey: settingsConfig.apiKey,
        voiceName: settingsConfig.voiceName,
        voiceRate: settingsConfig.voiceRate
      },
      () => setSpeakingMessageId(messageId),
      () => setSpeakingMessageId(null),
      () => setSpeakingMessageId(null)
    );
  };

  return (
    <div 
      className="chat-window-container" 
      ref={containerRef}
      onClick={handleContainerClick}
    >
      {messages.length === 0 ? (
        <div className="chat-empty-state">
          <Bot size={48} className="empty-logo" />
          <h2>LAKSHYA AI Companion</h2>
          <p>I can help you analyze, summarize, and understand webpage articles or PDF files.</p>
          <div className="empty-suggestions">
            <div className="suggestion-card">"Summarize this article"</div>
            <div className="suggestion-card">"Explain this page like a beginner"</div>
            <div className="suggestion-card">"Read the main key points aloud"</div>
          </div>
        </div>
      ) : (
        <div className="messages-list">
          {messages.map((msg) => (
            <div 
              key={msg.id || msg.timestamp} 
              className={`message-row ${msg.role === 'user' ? 'row-user' : 'row-ai'}`}
            >
              <div className="msg-avatar">
                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className="msg-bubble">
                <div 
                  className="msg-content"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }}
                />
                <div className="msg-meta">
                  <span className="msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {msg.role === 'assistant' && (
                    <button
                      onClick={() => handleReadMessage(msg.id || msg.timestamp, msg.content)}
                      className={`read-msg-btn ${speakingMessageId === (msg.id || msg.timestamp) ? 'active' : ''}`}
                      title={speakingMessageId === (msg.id || msg.timestamp) ? 'Stop reading' : 'Read message aloud'}
                    >
                      <Volume2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {isStreaming && (
            <div className="message-row row-ai streaming">
              <div className="msg-avatar pulsing">
                <Bot size={16} />
              </div>
              <div className="msg-bubble">
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
