import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import settings from '../utils/settings';
import voice from '../utils/voice';
import ChatWindow from '../components/ChatWindow';
import ModelSelector from '../components/ModelSelector';
import SettingsModal from '../components/SettingsModal';
import VoiceController from '../components/VoiceController';
import { 
  Bot, Plus, Settings, MessageSquare, Trash2, Send, 
  FileText, Server, AlertCircle, Sparkles, BookOpen, Camera, X, Table, Paperclip, RefreshCw
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
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const [activeAttachment, setActiveAttachment] = useState(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [stopVoiceSignal, setStopVoiceSignal] = useState(0);
  const [imageInput, setImageInput] = useState(null);
  const [imageName, setImageName] = useState('');

  const pdfInputRef = useRef(null);
  const spreadsheetInputRef = useRef(null);

  // Study Mode state
  const [workspaceTab, setWorkspaceTab] = useState('chat'); // 'chat' or 'study'
  const [studySource, setStudySource] = useState('webpage'); // 'webpage', 'document', 'image'
  const [studyType, setStudyType] = useState('quiz'); // 'quiz', 'flashcards', 'notes', 'viva', 'interview'
  const [studyCount, setStudyCount] = useState(5);
  const [generatingStudy, setGeneratingStudy] = useState(false);
  const [studyError, setStudyError] = useState('');
  const [studyData, setStudyData] = useState(null);

  // Active quiz states
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelections, setQuizSelections] = useState({});
  const [quizScore, setQuizScore] = useState(null);

  // Active flashcard states
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setImageInput(event.target.result); // Base64 data URL
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
  };

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
      setActiveAttachment(null);
    } catch (e) {
      console.error('Failed to create new chat session:', e);
    }
  };

  // Select conversation
  const handleSelectConversation = (id) => {
    if (isStreaming) return;
    voice.stopSpeaking();
    setActiveConvId(id);
    setActiveAttachment(null);
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
    setStopVoiceSignal(prev => prev + 1);
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

      // Step B: Save user message in local DB (with placeholder image text if present)
      const dbText = imageInput ? `[Uploaded Image: ${imageName}] ${text}` : text;
      const userMsg = await api.saveMessage(currentConvId, 'user', dbText);
      
      // Inject image locally for rendering bubble thumbnail in session
      const displayMsg = { ...userMsg, content: text, image: imageInput };
      
      const updatedMessages = [...messages, displayMsg];
      setMessages(updatedMessages);
      setIsStreaming(true);

      // Capture active image context and clear local states
      const activeImage = imageInput;
      setImageInput(null);
      setImageName('');

      // Refresh list to show updated title if it was first message
      await loadConversations(appSettings);

      // Retrieve file/document context from Chrome local storage if available
      let fileContext = null;
      if (currentConvId) {
        try {
          const stored = await new Promise((resolve) => {
            chrome.storage.local.get(`file_context_${currentConvId}`, resolve);
          });
          if (stored && stored[`file_context_${currentConvId}`]) {
            fileContext = stored[`file_context_${currentConvId}`];
          }
        } catch (err) {
          console.warn('Could not read session file context:', err);
        }
      }

      // Step C: Execute streaming chat completion
      let assistantResponse = '';
      
      await api.chatStream(
        updatedMessages.map(m => ({ role: m.role, content: m.content })),
        appSettings,
        activeTabContext,
        fileContext,
        activeImage,
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

  // 6. Handle Unified File Ingestion (PDF / Spreadsheets)
  const loadFileIntoChat = async ({ file, kind, parseFile, promptLabel, extensionCheck }) => {
    if (!file || !backendOnline || uploadingFile || !appSettings) return;

    if (!extensionCheck(file)) {
      setAttachmentStatus(`Choose a ${kind} file.`);
      setTimeout(() => setAttachmentStatus(''), 3000);
      return;
    }

    setUploadingFile(true);
    const storeInDb = appSettings?.savePdfToDb || false;
    setAttachmentStatus(`Loading ${kind}...`);

    try {
      let targetConvId = activeConvId;
      if (!targetConvId) {
        const newConv = await api.createConversation(`${promptLabel}: ${file.name.substring(0, 18)}`, appSettings?.model);
        targetConvId = newConv.id;
        setActiveConvId(targetConvId);
        setConversations(prev => [newConv, ...prev]);
        setMessages([]);
      }

      const result = await parseFile(file, appSettings, storeInDb);

      if (!storeInDb && result.text) {
        await new Promise((resolve) => {
          chrome.storage.local.set({
            [`file_context_${targetConvId}`]: { title: file.name, text: result.text }
          }, resolve);
        });
      }

      const detailText = kind === 'spreadsheet'
        ? `${result.sheets || 1} sheet(s), ${result.rows || 0} rows`
        : `${result.pages || 1} page(s)`;
        
      setActiveAttachment({
        kind: promptLabel,
        name: file.name,
        detail: detailText
      });
      await loadConversations(appSettings);
      setInputValue(current => current || `Summarize this ${kind}.`);
      setAttachmentStatus(`${promptLabel} ready`);
    } catch (error) {
      console.error(error);
      setAttachmentStatus(`Error: ${error.message || 'failed'}`);
    } finally {
      setTimeout(() => setAttachmentStatus(''), 4000);
      setUploadingFile(false);
    }
  };

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    await loadFileIntoChat({
      file,
      kind: 'PDF',
      parseFile: api.ingestPdf,
      promptLabel: 'PDF',
      extensionCheck: (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    });
  };

  const handleSpreadsheetUpload = async (e) => {
    const file = e.target.files[0];
    await loadFileIntoChat({
      file,
      kind: 'spreadsheet',
      parseFile: api.ingestSpreadsheet,
      promptLabel: 'Spreadsheet',
      extensionCheck: (f) => /\.(xlsx|csv|tsv)$/i.test(f.name)
    });
  };

  const handleGenerateStudyMaterial = async () => {
    setGeneratingStudy(true);
    setStudyError('');
    setStudyData(null);
    setQuizScore(null);
    setQuizSelections({});
    setQuizIndex(0);
    setFlashcardIndex(0);
    setFlashcardFlipped(false);

    try {
      let textContent = '';

      if (studySource === 'webpage') {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          const tabContent = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTENT' }, resolve);
          });
          if (tabContent && tabContent.success && tabContent.text) {
            textContent = tabContent.text;
          }
        }
      } else if (studySource === 'document') {
        if (activeConvId) {
          const stored = await new Promise((resolve) => {
            chrome.storage.local.get(`file_context_${activeConvId}`, resolve);
          });
          if (stored && stored[`file_context_${activeConvId}`]) {
            textContent = stored[`file_context_${activeConvId}`].text;
          }
        }
      } else if (studySource === 'image') {
        if (!imageInput) {
          throw new Error('No webpage or document content found. Please use Read Page Content or upload a document first.');
        }
        textContent = 'Uploaded Image Content';
      }

      // Check that content has been successfully extracted
      if ((studySource !== 'image' && (!textContent || !textContent.trim())) || (studySource === 'image' && !imageInput)) {
        throw new Error('No webpage or document content found. Please use Read Page Content or upload a document first.');
      }

      const result = await api.generateStudyMaterial(
        studyType,
        textContent,
        studyCount,
        appSettings,
        studySource === 'image' ? imageInput : null
      );

      setStudyData(result);
    } catch (err) {
      console.error(err);
      setStudyError(err.message || 'Failed to generate study material.');
    } finally {
      setGeneratingStudy(false);
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
          <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span className="active-chat-title">
              {conversations.find(c => c.id === activeConvId)?.title || 'AI Companion'}
            </span>
            <div className="workspace-tabs" style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <button 
                onClick={() => setWorkspaceTab('chat')} 
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600', border: 'none', borderRadius: '6px', background: workspaceTab === 'chat' ? 'var(--color-primary)' : 'transparent', color: workspaceTab === 'chat' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', transition: 'var(--transition)' }}
              >
                Chat
              </button>
              <button 
                onClick={() => setWorkspaceTab('study')} 
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600', border: 'none', borderRadius: '6px', background: workspaceTab === 'study' ? 'var(--color-primary)' : 'transparent', color: workspaceTab === 'study' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', transition: 'var(--transition)' }}
              >
                Study Mode
              </button>
            </div>
          </div>

          <div className="header-right">
            {/* Read Aloud speaker toggle */}
            {appSettings && (
              <button 
                onClick={async () => {
                  const newVal = !appSettings.audioEnabled;
                  setAppSettings(prev => ({ ...prev, audioEnabled: newVal }));
                  await settings.set('audioEnabled', newVal);
                }}
                className="input-action-btn"
                style={{ padding: '6px 10px', height: '34px', background: appSettings.audioEnabled ? 'rgba(16, 163, 127, 0.15)' : 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: appSettings.audioEnabled ? 'var(--color-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '500', borderRadius: '10px', cursor: 'pointer' }}
                title="Toggle Auto Read Aloud"
              >
                <BookOpen size={12} />
                <span>TTS: {appSettings.audioEnabled ? 'ON' : 'OFF'}</span>
              </button>
            )}

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

        {workspaceTab === 'chat' ? (
          <>
            {/* Chat Logs */}
            <ChatWindow 
              messages={messages} 
              isStreaming={isStreaming} 
              settingsConfig={appSettings || {}} 
            />

            {/* Loading File banner */}
            {attachmentStatus && (
              <div className="pdf-upload-banner" style={{ margin: '12px auto', maxWidth: '800px', width: 'calc(100% - 48px)', padding: '10px 16px', borderRadius: '10px', backgroundColor: 'rgba(16, 163, 127, 0.08)', border: '1px solid rgba(16, 163, 127, 0.2)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-primary)' }}>
                {uploadingFile ? <RefreshCw className="spin" size={14} /> : <Paperclip size={14} />}
                <span>{attachmentStatus}</span>
              </div>
            )}

            {/* Input Bar panel */}
            <div className="input-panel">
              <div className="input-wrapper" style={{ position: 'relative' }}>
                {/* Active File Attachment Pill */}
                {activeAttachment && (
                  <div className="sp-active-attachment" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', width: 'fit-content' }}>
                    {activeAttachment.kind === 'PDF' ? <FileText size={14} style={{ color: 'var(--color-primary)' }} /> : <Table size={14} style={{ color: 'var(--color-secondary)' }} />}
                    <div style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', textAlign: 'left' }}>
                      <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{activeAttachment.name}</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>{activeAttachment.kind} loaded · {activeAttachment.detail}</span>
                    </div>
                    <button onClick={() => setActiveAttachment(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px' }} title="Remove file">
                      <X size={12} />
                    </button>
                  </div>
                )}

                {imageInput && (
                  <div className="sp-image-preview-container">
                    <img src={imageInput} alt="Preview" className="sp-image-preview-thumbnail" />
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {imageName}
                    </span>
                    <button onClick={() => { setImageInput(null); setImageName(''); }} className="sp-image-preview-remove" title="Remove image">
                      <X size={10} />
                    </button>
                  </div>
                )}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* ChatGPT-style Unified Plus Attachment Trigger */}
                    <button
                      type="button"
                      onClick={() => setAttachmentMenuOpen(prev => !prev)}
                      disabled={uploadingFile || !backendOnline || !appSettings}
                      style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'var(--transition)' }}
                      title="Add file or image"
                    >
                      <Plus size={14} />
                    </button>

                    {/* Dropdown Menu */}
                    {attachmentMenuOpen && (
                      <div className="dashboard-attachment-menu" style={{ position: 'absolute', bottom: '46px', left: '16px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px', boxShadow: 'var(--shadow-lg)', zIndex: 30 }}>
                        <button type="button" onClick={() => { pdfInputRef.current?.click(); setAttachmentMenuOpen(false); }} style={{ border: 0, borderRadius: '10px', padding: '8px 12px', background: 'transparent', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                          <FileText size={14} style={{ color: 'var(--color-primary)' }} />
                          <span>PDF Document</span>
                        </button>
                        <button type="button" onClick={() => { spreadsheetInputRef.current?.click(); setAttachmentMenuOpen(false); }} style={{ border: 0, borderRadius: '10px', padding: '8px 12px', background: 'transparent', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                          <Table size={14} style={{ color: 'var(--color-secondary)' }} />
                          <span>Excel / CSV</span>
                        </button>
                        <button type="button" onClick={() => { document.getElementById('dashboard-image-file-input').click(); setAttachmentMenuOpen(false); }} style={{ border: 0, borderRadius: '10px', padding: '8px 12px', background: 'transparent', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                          <Camera size={14} style={{ color: 'var(--color-accent)' }} />
                          <span>Upload Image</span>
                        </button>
                      </div>
                    )}

                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handlePdfUpload}
                      style={{ display: 'none' }}
                    />
                    <input
                      ref={spreadsheetInputRef}
                      type="file"
                      accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
                      onChange={handleSpreadsheetUpload}
                      style={{ display: 'none' }}
                    />
                    <input
                      type="file"
                      id="dashboard-image-file-input"
                      accept="image/*"
                      onChange={handleImageSelect}
                      style={{ display: 'none' }}
                    />

                    {appSettings && (
                      <VoiceController 
                        settingsConfig={appSettings} 
                        onSpeechInput={(transcript) => setInputValue(transcript)} 
                        isAssistantStreaming={isStreaming}
                        stopSignal={stopVoiceSignal}
                      />
                    )}
                  </div>

                  <button
                    onClick={() => handleSendMessage()}
                    disabled={(!inputValue.trim() && !imageInput && !activeAttachment) || isStreaming || !backendOnline}
                    className="send-btn"
                    title="Send message"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="study-workspace-container">
            {/* Study Mode Setup Card */}
            <div className="study-setup-card animate-fade-in">
              <div className="study-title-row">
                <BookOpen size={20} />
                <span>Study Mode Configuration</span>
              </div>

              <div className="study-setup-grid">
                <div className="study-setup-group">
                  <label>Select Source Material</label>
                  <select 
                    value={studySource} 
                    onChange={(e) => setStudySource(e.target.value)}
                    className="study-select"
                  >
                    <option value="webpage">🌐 Current Webpage</option>
                    <option value="document">📄 Active Document (PDF / CSV / Excel)</option>
                    <option value="image">📷 Uploaded Image (OCR + Vision)</option>
                  </select>
                </div>

                <div className="study-setup-group">
                  <label>Study Activity Type</label>
                  <select 
                    value={studyType} 
                    onChange={(e) => setStudyType(e.target.value)}
                    className="study-select"
                  >
                    <option value="quiz">📝 Interactive Multiple-Choice Quiz</option>
                    <option value="flashcards">🎴 Flippable Concept Flashcards</option>
                    <option value="notes">📚 Comprehensive Study Notes & Summary</option>
                    <option value="viva">🎤 Viva Voice Prep Q&A</option>
                    <option value="interview">💼 Job Interview Prep Q&A</option>
                  </select>
                </div>

                {['quiz', 'flashcards', 'viva', 'interview'].includes(studyType) && (
                  <div className="study-setup-group">
                    <label>Count (2 to 15)</label>
                    <input 
                      type="number" 
                      min="2" 
                      max="15" 
                      value={studyCount} 
                      onChange={(e) => setStudyCount(Math.max(2, Math.min(15, parseInt(e.target.value) || 5)))}
                      className="study-input"
                    />
                  </div>
                )}
              </div>

              <button 
                onClick={handleGenerateStudyMaterial}
                disabled={generatingStudy || !backendOnline}
                className="generate-study-btn"
              >
                {generatingStudy ? (
                  <>
                    <RefreshCw className="spin" size={16} />
                    <span>Analyzing content and generating study aids...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>Generate Study Material</span>
                  </>
                )}
              </button>
            </div>

            {/* Error Display */}
            {studyError && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '12px', padding: '16px', color: '#ef4444', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                  <AlertCircle size={18} />
                  <span>Content Validation Warning</span>
                </div>
                <p style={{ fontSize: '13.5px', margin: 0 }}>{studyError}</p>
              </div>
            )}

            {/* Quiz Render */}
            {studyData && studyType === 'quiz' && studyData.questions && (
              <div className="quiz-container">
                {studyData.limitedInfoNotice && (
                  <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={14} />
                    <span>{studyData.limitedInfoNotice}</span>
                  </div>
                )}

                {quizScore !== null ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                    <Sparkles size={48} style={{ color: 'var(--color-primary)' }} />
                    <h3 style={{ fontSize: '22px', fontWeight: 'bold' }}>Quiz Completed!</h3>
                    <p style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>
                      You answered <strong>{quizScore}</strong> out of <strong>{studyData.questions.length}</strong> questions correctly.
                    </p>
                    <button 
                      onClick={() => { setQuizScore(null); setQuizSelections({}); setQuizIndex(0); }} 
                      className="generate-study-btn"
                      style={{ width: 'fit-content' }}
                    >
                      Restart Quiz
                    </button>
                  </div>
                ) : (
                  <div className="quiz-question-box">
                    <div className="quiz-header">
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                        QUESTION {quizIndex + 1} OF {studyData.questions.length}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-primary)' }}>
                        Score: {Object.values(quizSelections).filter((sel, i) => sel === studyData.questions[i].answer).length}
                      </span>
                    </div>

                    <h3 style={{ fontSize: '16px', fontWeight: '700', lineHeight: '1.5' }}>
                      {studyData.questions[quizIndex].question}
                    </h3>

                    <div className="quiz-options-list">
                      {studyData.questions[quizIndex].options.map((option, idx) => {
                        const isSelected = quizSelections[quizIndex] !== undefined;
                        const selectedVal = quizSelections[quizIndex];
                        const isCorrect = option === studyData.questions[quizIndex].answer;
                        const isUserSelection = option === selectedVal;

                        let btnClass = 'quiz-option-btn';
                        if (isSelected) {
                          if (isCorrect) btnClass += ' correct';
                          else if (isUserSelection) btnClass += ' incorrect';
                        }

                        return (
                          <button
                            key={idx}
                            disabled={isSelected}
                            onClick={() => {
                              setQuizSelections(prev => ({ ...prev, [quizIndex]: option }));
                            }}
                            className={btnClass}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>

                    {quizSelections[quizIndex] !== undefined && (
                      <div className="quiz-explanation-box animate-fade-in">
                        <strong>Explanation:</strong>
                        <p style={{ margin: '4px 0 0 0' }}>{studyData.questions[quizIndex].explanation}</p>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                      {quizSelections[quizIndex] !== undefined && (
                        <button
                          onClick={() => {
                            if (quizIndex < studyData.questions.length - 1) {
                              setQuizIndex(prev => prev + 1);
                            } else {
                              const correctCount = Object.keys(quizSelections).reduce((acc, idx) => {
                                return acc + (quizSelections[idx] === studyData.questions[idx].answer ? 1 : 0);
                              }, 0);
                              setQuizScore(correctCount);
                            }
                          }}
                          className="generate-study-btn"
                          style={{ width: 'fit-content' }}
                        >
                          {quizIndex < studyData.questions.length - 1 ? 'Next Question' : 'View Results'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Flashcard Render */}
            {studyData && studyType === 'flashcards' && Array.isArray(studyData) && (
              <div className="flashcard-deck">
                <div 
                  className={`flashcard-container ${flashcardFlipped ? 'flipped' : ''}`}
                  onClick={() => setFlashcardFlipped(prev => !prev)}
                >
                  <div className="flashcard-inner">
                    <div className="flashcard-front">
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>Concept</span>
                      <h3>{studyData[flashcardIndex].front}</h3>
                      <span style={{ fontSize: '11px', color: 'var(--color-primary)', marginTop: '24px' }}>Click card to flip and reveal details</span>
                    </div>
                    <div className="flashcard-back">
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>Explanation</span>
                      <p>{studyData[flashcardIndex].back}</p>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '24px' }}>Click card to flip back</span>
                    </div>
                  </div>
                </div>

                <div className="flashcard-nav">
                  <button 
                    disabled={flashcardIndex === 0} 
                    onClick={() => { setFlashcardIndex(prev => prev - 1); setFlashcardFlipped(false); }}
                    className="flashcard-btn"
                    title="Previous card"
                  >
                    ←
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: '600' }}>
                    {flashcardIndex + 1} OF {studyData.length}
                  </span>
                  <button 
                    disabled={flashcardIndex === studyData.length - 1} 
                    onClick={() => { setFlashcardIndex(prev => prev + 1); setFlashcardFlipped(false); }}
                    className="flashcard-btn"
                    title="Next card"
                  >
                    →
                  </button>
                </div>
              </div>
            )}

            {/* Notes / Summary Render */}
            {studyData && studyType === 'notes' && (
              <div className="notes-container animate-fade-in">
                {studyData.summary && (
                  <div className="notes-section">
                    <h3>Summary Notes</h3>
                    <div className="notes-markdown">
                      {studyData.summary.split('\n').map((para, i) => {
                        const trimmed = para.trim();
                        if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                          return <li key={i} style={{ margin: '6px 0 6px 20px', listStyleType: 'disc' }}>{trimmed.substring(1).trim()}</li>;
                        }
                        if (trimmed.startsWith('###')) {
                          return <h5 key={i} style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '14px', marginBottom: '8px' }}>{trimmed.substring(3).trim()}</h5>;
                        }
                        if (trimmed.startsWith('##')) {
                          return <h4 key={i} style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '16px', marginBottom: '8px', color: 'var(--color-primary)' }}>{trimmed.substring(2).trim()}</h4>;
                        }
                        return <p key={i} style={{ marginBottom: '10px' }}>{para}</p>;
                      })}
                    </div>
                  </div>
                )}

                {studyData.keyPoints && studyData.keyPoints.length > 0 && (
                  <div className="notes-section">
                    <h3>Key Points</h3>
                    <ul style={{ paddingLeft: '20px' }}>
                      {studyData.keyPoints.map((point, idx) => (
                        <li key={idx} style={{ marginBottom: '8px', listStyleType: 'circle', fontSize: '14.5px', lineHeight: '1.6' }}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Viva & Interview Questions Render */}
            {studyData && ['viva', 'interview'].includes(studyType) && studyData.questions && (
              <div className="notes-container animate-fade-in">
                {studyData.limitedInfoNotice && (
                  <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={14} />
                    <span>{studyData.limitedInfoNotice}</span>
                  </div>
                )}

                <div className="notes-section">
                  <h3 style={{ textTransform: 'capitalize' }}>{studyType} Questions Prep</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
                    {studyData.questions.map((q, idx) => {
                      const isExpanded = !!expandedQuestions[idx];
                      return (
                        <div 
                          key={idx} 
                          style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--bg-tertiary)' }}
                        >
                          <button
                            onClick={() => setExpandedQuestions(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            style={{ width: '100%', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontWeight: '600', fontSize: '14.5px', cursor: 'pointer', textAlign: 'left' }}
                          >
                            <span>Q{idx + 1}: {q.question}</span>
                            <span style={{ fontSize: '18px', color: 'var(--color-primary)' }}>{isExpanded ? '−' : '+'}</span>
                          </button>
                          {isExpanded && (
                            <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                              <strong>Correct Answer:</strong>
                              <p style={{ margin: '6px 0 0 0' }}>{q.answer}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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
