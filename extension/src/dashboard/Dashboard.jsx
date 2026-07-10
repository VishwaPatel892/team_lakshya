import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import settings from '../utils/settings';
import voice from '../utils/voice';
import ChatWindow from '../components/ChatWindow';
import ModelSelector from '../components/ModelSelector';
import SettingsModal from '../components/SettingsModal';
import VoiceController from '../components/VoiceController';
import { 
  Bot, Plus, Settings, MessageSquare, Trash2, Send, 
  FileText, Server, AlertCircle, Sparkles, BookOpen 
} from 'lucide-react';

export default function Dashboard() {
  // Config states
  const [appSettings, setAppSettings] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  // Conversational states
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // UI input states
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');

  // 1. Initial Load settings and connect to backend
  useEffect(() => {
    async function init() {
      const config = await settings.getAll();
      setAppSettings(config);
      
      const online = await api.checkStatus();
      setBackendOnline(online);
      
      if (online) {
        await loadConversations(config);
      }
    }
    init();
  }, []);

  // Check connection status periodically
  useEffect(() => {
    const timer = setInterval(async () => {
      const online = await api.checkStatus();
      setBackendOnline(online);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // 2. Load conversations list
  const loadConversations = async (config) => {
    try {
      const list = await api.getConversations();
      setConversations(list);
      
      // Auto-activate the latest conversation if none is active
      if (list.length > 0 && !activeConvId) {
        handleSelectConversation(list[0].id);
      } else if (list.length === 0) {
        handleNewChat(config || appSettings);
      }
    } catch (e) {
      console.error('Error loading conversations:', e);
    }
  };

  // 3. Load messages for active conversation
  const loadMessages = async (convId) => {
    try {
      const list = await api.getMessages(convId);
      setMessages(list);
    } catch (e) {
      console.error('Error loading messages:', e);
    }
  };

  // 4. Trigger new conversation
  const handleNewChat = async (config = appSettings) => {
    if (isStreaming) return;
    try {
      const activeModel = config?.model || 'Default Model';
      const newConv = await api.createConversation('New Chat', activeModel);
      setConversations(prev => [newConv, ...prev]);
      setActiveConvId(newConv.id);
      setMessages([]);
    } catch (e) {
      console.error('Failed to create new chat session:', e);
    }
  };

  // Select conversation
  const handleSelectConversation = (id) => {
    if (isStreaming) return;
    voice.stopSpeaking();
    setActiveConvId(id);
    loadMessages(id);
  };

  // Delete conversation
  const handleDeleteConversation = async (id, e) => {
    e.stopPropagation();
    if (isStreaming) return;
    if (!window.confirm('Delete this conversation?')) return;

    try {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
        // Create or select another one
        const remaining = conversations.filter(c => c.id !== id);
        if (remaining.length > 0) {
          handleSelectConversation(remaining[0].id);
        } else {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // 5. Send chat message
  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputValue;
    if (!text.trim() || isStreaming || !backendOnline) return;

    setInputValue('');
    voice.stopSpeaking();

    let currentConvId = activeConvId;
    let activeTabContext = null;

    // Fetch active webpage context dynamically
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        const tabContent = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTENT' }, (response) => {
            if (response && response.success) {
              resolve(response);
            } else {
              resolve(null);
            }
          });
        });
        if (tabContent) {
          activeTabContext = {
            title: tabContent.title,
            url: tabContent.url,
            text: tabContent.text ? tabContent.text.substring(0, 15000) : ''
          };
        }
      } catch (err) {
        console.warn('Could not fetch active tab context:', err);
      }
    }

    try {
      // Step A: Auto-create conversation if missing
      if (!currentConvId) {
        const activeModel = appSettings.model || 'Default Model';
        const newConv = await api.createConversation(
          text.substring(0, 30),
          activeModel
        );
        currentConvId = newConv.id;
        setActiveConvId(currentConvId);
        setConversations(prev => [newConv, ...prev]);
      }

      // Step B: Save user message in local DB
      const userMsg = await api.saveMessage(currentConvId, 'user', text);
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsStreaming(true);

      // Refresh list to show updated title if it was first message
      await loadConversations(appSettings);

      // Step C: Execute streaming chat completion
      let assistantResponse = '';
      
      await api.chatStream(
        updatedMessages.map(m => ({ role: m.role, content: m.content })),
        appSettings,
        activeTabContext,
        (chunk) => {
          assistantResponse += chunk;
          // Render chunk in UI dynamically
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.id === 'temp_ai') {
              return [...prev.slice(0, -1), { ...last, content: assistantResponse }];
            } else {
              return [...prev, { id: 'temp_ai', role: 'assistant', content: assistantResponse, timestamp: new Date().toISOString() }];
            }
          });
        },
        async () => {
          // Completed stream -> Save assistant message to DB
          setIsStreaming(false);
          if (assistantResponse) {
            await api.saveMessage(currentConvId, 'assistant', assistantResponse);
            loadMessages(currentConvId); // Refresh with permanent DB IDs
            
            // Auto read aloud if enabled
            if (appSettings.audioEnabled) {
              voice.speak(
                assistantResponse,
                appSettings,
                () => console.log('Speaking response...'),
                () => console.log('Response finished.')
              );
            }
          }
        },
        (error) => {
          setIsStreaming(false);
          console.error(error);
          setMessages(prev => [
            ...prev,
            { id: 'error_ai', role: 'assistant', content: `⚠️ Error completing prompt: ${error.message || 'Check model endpoint connections.'}`, timestamp: new Date().toISOString() }
          ]);
        }
      );
    } catch (e) {
      console.error('Failed to execute chat send:', e);
      setIsStreaming(false);
    }
  };

  // 6. Handle PDF file uploads
  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !backendOnline) return;

    if (file.type !== 'application/pdf') {
      alert('Only PDF files are supported.');
      return;
    }

    setUploadingPdf(true);
    setPdfStatus('Parsing and indexing PDF...');
    
    try {
      const result = await api.ingestPdf(file, appSettings);
      setPdfStatus(`PDF Index completed! Added ${result.chunksAdded} chunks to ChromaDB.`);
      
      // Inject alert message in current chat
      const uploadNotification = `[File Ingested]: "${file.name}" has been processed and stored in ChromaDB (${result.pages} pages, ${result.chunksAdded} text segments). You can now ask questions about its content!`;
      
      if (activeConvId) {
        const notifyMsg = await api.saveMessage(activeConvId, 'assistant', uploadNotification);
        setMessages(prev => [...prev, notifyMsg]);
      } else {
        const newConv = await api.createConversation(`Ingested PDF: ${file.name.substring(0, 15)}`, appSettings.model);
        setActiveConvId(newConv.id);
        const notifyMsg = await api.saveMessage(newConv.id, 'assistant', uploadNotification);
        setMessages([notifyMsg]);
        await loadConversations(appSettings);
      }

      setTimeout(() => {
        setPdfStatus('');
        setUploadingPdf(false);
      }, 4000);

    } catch (err) {
      console.error(err);
      setPdfStatus('Failed to ingest PDF: ' + err.message);
      setTimeout(() => setPdfStatus(''), 4000);
      setUploadingPdf(false);
    }
  };

  // Model selection sync
  const handleModelSelect = async (modelId) => {
    const updated = { ...appSettings, model: modelId };
    setAppSettings(updated);
    await settings.set('model', modelId);
  };

  // Save settings from modal
  const handleSaveSettings = async (newSettings) => {
    const updated = { ...appSettings, ...newSettings };
    setAppSettings(updated);
    await settings.setMultiple(newSettings);
    // Reload models list if needed
    loadConversations(updated);
  };

  return (
    <div className="dashboard-container">
      {/* 1. Left Sidebar - Chat list & connection */}
      <div className="sidebar">
        <div className="sidebar-header">
          <Bot className="sidebar-logo animate-pulse" size={24} />
          <h1>LAKSHYA</h1>
        </div>

        <button onClick={() => handleNewChat()} className="new-chat-btn" disabled={isStreaming}>
          <Plus size={16} /> New Chat
        </button>

        <div className="conversations-history">
          <div className="history-label">Recent Conversations</div>
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => handleSelectConversation(conv.id)}
              className={`conv-item-card ${activeConvId === conv.id ? 'active' : ''}`}
            >
              <MessageSquare size={14} className="conv-icon" />
              <span className="conv-title">{conv.title}</span>
              <button
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="conv-delete-btn"
                title="Delete chat"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className={`status-dot ${backendOnline ? 'online' : 'offline'}`}></div>
            <span>{backendOnline ? 'Backend Online' : 'Connecting Backend...'}</span>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="settings-btn">
            <Settings size={16} /> Settings
          </button>
        </div>
      </div>

      {/* 2. Main Chat Workspace */}
      <div className="chat-workspace">
        <div className="workspace-header">
          <div className="header-left">
            <span className="active-chat-title">
              {conversations.find(c => c.id === activeConvId)?.title || 'AI Companion'}
            </span>
          </div>

          <div className="header-right">
            {/* Model select */}
            {appSettings && (
              <ModelSelector 
                settingsConfig={appSettings} 
                onModelChange={handleModelSelect} 
              />
            )}
            
            {/* RAG status pill */}
            {appSettings?.ragEnabled && (
              <div className="rag-status-pill" title="Semantic context injection from ChromaDB is active">
                <Sparkles size={12} />
                <span>RAG Active</span>
              </div>
            )}
          </div>
        </div>

        {/* Chat Logs */}
        <ChatWindow 
          messages={messages} 
          isStreaming={isStreaming} 
          settingsConfig={appSettings || {}} 
        />

        {/* Loading PDF bar */}
        {uploadingPdf && (
          <div className="pdf-upload-banner">
            <FileText className="spin" size={16} />
            <span>{pdfStatus}</span>
          </div>
        )}

        {/* Input Bar panel */}
        <div className="input-panel">
          <div className="input-actions-bar">
            {/* PDF Upload Button */}
            <label className="input-action-btn pdf-upload-label" title="Upload and parse PDF document">
              <input 
                type="file" 
                accept=".pdf" 
                onChange={handlePdfUpload}
                disabled={uploadingPdf || !backendOnline} 
                style={{ display: 'none' }}
              />
              <FileText size={18} />
              <span>Add PDF</span>
            </label>

            {/* Read Aloud Toggle */}
            {appSettings && (
              <button 
                onClick={async () => {
                  const newVal = !appSettings.audioEnabled;
                  setAppSettings(prev => ({ ...prev, audioEnabled: newVal }));
                  await settings.set('audioEnabled', newVal);
                }}
                className={`input-action-btn ${appSettings.audioEnabled ? 'active' : ''}`}
                title="Toggle Auto Read Aloud"
              >
                <BookOpen size={18} />
                <span>Read Aloud: {appSettings.audioEnabled ? 'ON' : 'OFF'}</span>
              </button>
            )}
          </div>

          <div className="input-wrapper">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask anything or talk to LAKSHYA..."
              rows={2}
              className="chat-textarea"
              disabled={!backendOnline}
            />

            <div className="input-controls">
              {appSettings && (
                <VoiceController 
                  settingsConfig={appSettings} 
                  onSpeechInput={(transcript) => handleSendMessage(transcript)} 
                  isAssistantStreaming={isStreaming}
                />
              )}
              
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || isStreaming || !backendOnline}
                className="send-btn"
                title="Send message"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Settings Modal */}
      {isSettingsOpen && appSettings && (
        <SettingsModal
          currentSettings={appSettings}
          onSave={handleSaveSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
}
