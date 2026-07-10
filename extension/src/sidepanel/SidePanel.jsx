import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import settings from '../utils/settings';
import voice from '../utils/voice';
import ChatWindow from '../components/ChatWindow';
import ModelSelector from '../components/ModelSelector';
import SettingsModal from '../components/SettingsModal';
import VoiceController from '../components/VoiceController';
import { 
  Bot, Plus, Settings, MessageSquare, Send, 
  Sparkles, RefreshCw, BookOpen, Globe, X 
} from 'lucide-react';

export default function SidePanel() {
  const [appSettings, setAppSettings] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  // Conversations & messages
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // UI states
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [extractingPage, setExtractingPage] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState('');

  // 1. Initial Load
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

  // Poll connection
  useEffect(() => {
    const timer = setInterval(async () => {
      const online = await api.checkStatus();
      setBackendOnline(online);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Listen for text selection prompts injected from content script
  useEffect(() => {
    if (!appSettings || !backendOnline) return;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      // Check for prompt on mount/refresh
      chrome.storage.local.get(['pendingPrompt'], (result) => {
        if (result.pendingPrompt) {
          handleSendMessage(result.pendingPrompt);
          chrome.storage.local.remove(['pendingPrompt']);
        }
      });

      // Listen for real-time prompt injects while sidepanel is active
      const handleStorageChange = (changes, areaName) => {
        if (areaName === 'local' && changes.pendingPrompt?.newValue) {
          handleSendMessage(changes.pendingPrompt.newValue);
          chrome.storage.local.remove(['pendingPrompt']);
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, [appSettings, backendOnline, activeConvId, conversations]);

  const loadConversations = async (config) => {
    try {
      const list = await api.getConversations();
      setConversations(list);
      
      if (list.length > 0 && !activeConvId) {
        handleSelectConversation(list[0].id);
      } else if (list.length === 0) {
        handleNewChat(config || appSettings);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadMessages = async (convId) => {
    try {
      const list = await api.getMessages(convId);
      setMessages(list);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectConversation = (id) => {
    if (isStreaming) return;
    voice.stopSpeaking();
    setActiveConvId(id);
    loadMessages(id);
  };

  const handleNewChat = async (config = appSettings) => {
    if (isStreaming) return;
    try {
      const activeModel = config?.model || 'Default Model';
      const newConv = await api.createConversation('New Chat', activeModel);
      setConversations(prev => [newConv, ...prev]);
      setActiveConvId(newConv.id);
      setMessages([]);
    } catch (e) {
      console.error(e);
    }
  };

  // 2. Extract and Ingest active tab's article content
  const handleAnalyzePage = async () => {
    if (!backendOnline || extractingPage) return;
    
    setExtractingPage(true);
    setExtractionStatus('Extracting content...');

    // Request active tab extraction from background script
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTENT' }, async (response) => {
        if (!response || response.error) {
          setExtractionStatus('Cannot read this tab.');
          console.error(response?.error);
          setTimeout(() => {
            setExtractingPage(false);
            setExtractionStatus('');
          }, 3000);
          return;
        }

        setExtractionStatus('Indexing to Vector DB...');
        try {
          const { title, text, url } = response;
          const result = await api.ingestWebpage(text, url, title, appSettings);
          setExtractionStatus('Page Ingested!');

          // Inject system message in current conversation
          const notificationText = `[Webpage Ingested]: "${title}" (${url}) has been processed and saved to ChromaDB. You can now chat or ask questions about its content!`;
          
          let currentConvId = activeConvId;
          if (!currentConvId) {
            const newConv = await api.createConversation(`Chat on: ${title.substring(0, 15)}`, appSettings.model);
            currentConvId = newConv.id;
            setActiveConvId(currentConvId);
            await loadConversations(appSettings);
          }

          const notifyMsg = await api.saveMessage(currentConvId, 'assistant', notificationText);
          setMessages(prev => [...prev, notifyMsg]);

          // Auto trigger voice summary introduction
          if (appSettings.audioEnabled) {
            voice.speak(
              `I have successfully analyzed the webpage, ${title}. What would you like to know about it?`,
              appSettings
            );
          }

          setTimeout(() => {
            setExtractingPage(false);
            setExtractionStatus('');
          }, 3000);

        } catch (err) {
          console.error(err);
          setExtractionStatus('Ingest failed: ' + err.message);
          setTimeout(() => {
            setExtractingPage(false);
            setExtractionStatus('');
          }, 4000);
        }
      });
    } else {
      setExtractionStatus('Not in extension sandbox.');
      setTimeout(() => {
        setExtractingPage(false);
        setExtractionStatus('');
      }, 3000);
    }
  };

  // 3. Send Message
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
      if (!currentConvId) {
        const newConv = await api.createConversation(text.substring(0, 25), appSettings.model);
        currentConvId = newConv.id;
        setActiveConvId(currentConvId);
        setConversations(prev => [newConv, ...prev]);
      }

      const userMsg = await api.saveMessage(currentConvId, 'user', text);
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsStreaming(true);

      // Reload list to sync title
      await loadConversations(appSettings);

      let assistantResponse = '';
      
      await api.chatStream(
        updatedMessages.map(m => ({ role: m.role, content: m.content })),
        appSettings,
        activeTabContext,
        (chunk) => {
          assistantResponse += chunk;
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
          setIsStreaming(false);
          if (assistantResponse) {
            await api.saveMessage(currentConvId, 'assistant', assistantResponse);
            loadMessages(currentConvId);
            
            if (appSettings.audioEnabled) {
              voice.speak(assistantResponse, appSettings);
            }
          }
        },
        (error) => {
          setIsStreaming(false);
          setMessages(prev => [
            ...prev,
            { id: 'error_ai', role: 'assistant', content: `⚠️ Prompt error: ${error.message}`, timestamp: new Date().toISOString() }
          ]);
        }
      );
    } catch (e) {
      console.error(e);
      setIsStreaming(false);
    }
  };

  const handleModelSelect = async (modelId) => {
    const updated = { ...appSettings, model: modelId };
    setAppSettings(updated);
    await settings.set('model', modelId);
  };

  const handleSaveSettings = async (newSettings) => {
    const updated = { ...appSettings, ...newSettings };
    setAppSettings(updated);
    await settings.setMultiple(newSettings);
    loadConversations(updated);
  };

  return (
    <div className="sidepanel-container">
      {/* Top Header */}
      <div className="sp-header">
        <div className="sp-header-top">
          <div className="logo-section">
            <Bot className="logo-icon animate-pulse" size={18} />
            <h2>LAKSHYA</h2>
          </div>
          <div className="sp-header-actions">
            <button 
              onClick={() => handleNewChat()} 
              disabled={isStreaming}
              className="sp-action-btn"
              title="New Chat"
            >
              <Plus size={14} />
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="sp-action-btn"
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button 
              onClick={() => window.close()}
              className="sp-action-btn close-panel-btn"
              title="Close Panel"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Dynamic selector / sync */}
        <div className="sp-header-bar">
          {appSettings && (
            <ModelSelector 
              settingsConfig={appSettings} 
              onModelChange={handleModelSelect} 
            />
          )}
          
          <select
            value={activeConvId || ''}
            onChange={(e) => handleSelectConversation(e.target.value)}
            disabled={isStreaming || conversations.length === 0}
            className="sp-chat-selector"
          >
            {conversations.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>

        {/* Webpage Analyzer Action */}
        <button
          onClick={handleAnalyzePage}
          disabled={extractingPage || !backendOnline}
          className={`analyze-page-btn ${extractingPage ? 'loading' : ''}`}
        >
          {extractingPage ? (
            <RefreshCw className="spin" size={14} />
          ) : (
            <Globe size={14} />
          )}
          <span>{extractionStatus || 'Analyze Active Webpage'}</span>
        </button>
      </div>

      {/* Main Chat Logs */}
      <div className="sp-chat-body">
        <ChatWindow 
          messages={messages} 
          isStreaming={isStreaming} 
          settingsConfig={appSettings || {}} 
        />
      </div>

      {/* Input panel */}
      <div className="sp-input-panel">
        <div className="sp-input-actions">
          {appSettings && (
            <button 
              onClick={async () => {
                const newVal = !appSettings.audioEnabled;
                setAppSettings(prev => ({ ...prev, audioEnabled: newVal }));
                await settings.set('audioEnabled', newVal);
              }}
              className={`sp-audio-toggle ${appSettings.audioEnabled ? 'active' : ''}`}
              title="Toggle Read Aloud"
            >
              <BookOpen size={14} />
              <span>TTS: {appSettings.audioEnabled ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {appSettings?.ragEnabled && (
            <span className="sp-rag-badge" title="RAG vector DB search enabled">
              <Sparkles size={10} /> RAG Active
            </span>
          )}
        </div>

        <div className="sp-input-wrapper">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage();
            }}
            placeholder="Ask LAKSHYA..."
            disabled={!backendOnline}
            className="sp-input-field"
          />
          <div className="sp-controls">
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
              className="sp-send-btn"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
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
