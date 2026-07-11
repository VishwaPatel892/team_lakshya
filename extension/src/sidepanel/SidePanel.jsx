import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import settings from '../utils/settings';
import voice from '../utils/voice';
import ChatWindow from '../components/ChatWindow';
import ModelSelector from '../components/ModelSelector';
import SettingsModal from '../components/SettingsModal';
import VoiceController from '../components/VoiceController';
import { parseBrowserAutomationCommand, runBrowserAutomationCommand } from '../utils/browserAutomation';
import {
  findCustomUrlCommand,
  openCustomUrlCommand,
  parseSaveCustomUrlCommand,
  saveCustomUrlCommand
} from '../utils/customUrlCommands';
import { 
  Bot, Plus, Settings, MessageSquare, Send, 
  Sparkles, RefreshCw, BookOpen, Globe, X, FileText, Table, Paperclip, Camera, Zap
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
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const [activeAttachment, setActiveAttachment] = useState(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [stopVoiceSignal, setStopVoiceSignal] = useState(0);
  const pdfInputRef = useRef(null);
  const spreadsheetInputRef = useRef(null);
  const [imageInput, setImageInput] = useState(null);
  const [imageName, setImageName] = useState('');

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
          setInputValue(result.pendingPrompt);
          chrome.storage.local.remove(['pendingPrompt']);
        }
      });

      // Listen for real-time prompt injects while sidepanel is active
      const handleStorageChange = (changes, areaName) => {
        if (areaName === 'local' && changes.pendingPrompt?.newValue) {
          setInputValue(changes.pendingPrompt.newValue);
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
    setActiveAttachment(null);
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
      setActiveAttachment(null);
    } catch (e) {
      console.error(e);
    }
  };

  const loadFileIntoChat = async ({ file, kind, parseFile, promptLabel, extensionCheck }) => {
    if (!file || !backendOnline || uploadingFile || !appSettings) return;

    if (!extensionCheck(file)) {
      setAttachmentStatus(`Choose a ${kind} file.`);
      setTimeout(() => setAttachmentStatus(''), 3000);
      return;
    }

    setAttachmentMenuOpen(false);
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
    } catch (err) {
      console.error(err);
      setAttachmentStatus(`${promptLabel} failed: ${err.message}`);
    } finally {
      setUploadingFile(false);
      setTimeout(() => setAttachmentStatus(''), 5000);
    }
  };

  const handlePdfUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await loadFileIntoChat({
      file,
      kind: 'PDF',
      promptLabel: 'PDF',
      parseFile: api.ingestPdf,
      extensionCheck: selectedFile => selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf')
    });
  };

  const handleSpreadsheetUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await loadFileIntoChat({
      file,
      kind: 'spreadsheet',
      promptLabel: 'Spreadsheet',
      parseFile: api.ingestSpreadsheet,
      extensionCheck: selectedFile => /\.(xlsx|csv|tsv)$/i.test(selectedFile.name)
    });
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

  const handleAutoFillForm = async () => {
    if (!appSettings || !appSettings.formProfile || appSettings.formProfile.length === 0) {
      alert('Please configure your Auto-Fill Profile variables under Settings first.');
      return;
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const [tab] = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });

        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'FILL_FORM',
            profile: appSettings.formProfile
          }, (response) => {
            if (chrome.runtime.lastError) {
              alert('Could not fill form. Please reload the active tab first.');
              return;
            }
            if (response && response.success) {
              alert(`Form auto-fill complete! Filled ${response.filledCount} field(s).`);
            } else {
              alert('Auto-fill complete. No matching fields found.');
            }
          });
        }
      } else {
        alert('Form auto-fill is only supported inside the Chrome extension sidepanel/popup.');
      }
    } catch (err) {
      console.error(err);
      alert('Error triggering auto-fill: ' + err.message);
    }
  };

  // 3. Send Message
  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputValue;
    if ((!text.trim() && !imageInput) || isStreaming || !backendOnline) return;

    setInputValue('');
    setAttachmentMenuOpen(false);
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
      if (!currentConvId) {
        const newConv = await api.createConversation(text.substring(0, 25), appSettings.model);
        currentConvId = newConv.id;
        setActiveConvId(currentConvId);
        setConversations(prev => [newConv, ...prev]);
      }

      const customSaveCommand = parseSaveCustomUrlCommand(text, activeTabContext);
      if (customSaveCommand) {
        const userMsg = await api.saveMessage(currentConvId, 'user', text);
        setMessages(prev => [...prev, userMsg]);

        let responseText = '';
        if (customSaveCommand.needsUrl) {
          responseText = 'I can save that custom command. Please include the URL, or open the page first and say: "remember this URL as open my portfolio".';
        } else {
          const savedCommand = await saveCustomUrlCommand(customSaveCommand.phrase, customSaveCommand.url);
          responseText = `Saved custom command: "${savedCommand.phrase}" will open ${savedCommand.url}.`;
        }

        const aiMsg = await api.saveMessage(currentConvId, 'assistant', responseText);
        setMessages(prev => [...prev, aiMsg]);
        await loadConversations(appSettings);

        if (appSettings?.audioEnabled) {
          voice.speak(responseText, appSettings);
        }
        return;
      }

      const customOpenCommand = await findCustomUrlCommand(text);
      if (customOpenCommand) {
        const userMsg = await api.saveMessage(currentConvId, 'user', text);
        setMessages(prev => [...prev, userMsg]);

        let responseText = '';
        try {
          const result = await openCustomUrlCommand(customOpenCommand);
          responseText = `Opening "${customOpenCommand.phrase}" at ${result.url}.`;
        } catch (err) {
          console.error('Custom URL command failed:', err);
          responseText = `I found "${customOpenCommand.phrase}", but could not open it: ${err.message}`;
        }

        const aiMsg = await api.saveMessage(currentConvId, 'assistant', responseText);
        setMessages(prev => [...prev, aiMsg]);
        await loadConversations(appSettings);

        if (appSettings?.audioEnabled) {
          voice.speak(responseText, appSettings);
        }
        return;
      }

      const automationCommand = parseBrowserAutomationCommand(text);
      if (automationCommand) {
        const userMsg = await api.saveMessage(currentConvId, 'user', text);
        setMessages(prev => [...prev, userMsg]);

        let responseText = '';
        try {
          const result = await runBrowserAutomationCommand(automationCommand);
          responseText = `Opening ${result.siteLabel} and searching for "${result.query}".`;
        } catch (err) {
          console.error('Browser automation failed:', err);
          responseText = `I could not open ${automationCommand.siteLabel} automatically: ${err.message}`;
        }

        const aiMsg = await api.saveMessage(currentConvId, 'assistant', responseText);
        setMessages(prev => [...prev, aiMsg]);
        await loadConversations(appSettings);

        if (appSettings?.audioEnabled) {
          voice.speak(responseText, appSettings);
        }
        return;
      }

      // Check if user is requesting a form fill action (more flexible keyword matching)
      const cleanText = text.toLowerCase().trim();
      const isFormFillRequest = cleanText.includes('autofill') || 
                                cleanText.includes('auto fill') ||
                                (cleanText.includes('fill') && (
                                  cleanText.includes('form') || 
                                  cleanText.includes('field') || 
                                  cleanText.includes('input') || 
                                  cleanText.includes('detail') || 
                                  cleanText.includes('info') || 
                                  cleanText.includes('variable')
                                ));

      if (isFormFillRequest) {
        let filledCount = 0;
        let errorOccurred = false;
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs) {
            const [tab] = await new Promise((resolve) => {
              chrome.tabs.query({ active: true, currentWindow: true }, resolve);
            });
            if (tab && tab.id) {
              // 1. Fetch form fields from the active tab
              const getFieldsResponse = await new Promise((resolve) => {
                chrome.tabs.sendMessage(tab.id, { type: 'GET_FORM_FIELDS' }, (res) => {
                  if (chrome.runtime.lastError) resolve(null);
                  else resolve(res);
                });
              });

              if (getFieldsResponse && getFieldsResponse.success && getFieldsResponse.fields.length > 0) {
                // 2. Query the LLM to map conversation context + profile details to these fields
                const systemPrompt = `You are LAKSHYA's intelligent Form Filler. You are given:
1. A list of form fields on the active webpage.
2. The user's profile details: ${JSON.stringify(appSettings?.formProfile || [])}.
3. The conversation history which contains context (resumes, generated skills lists, summary notes, education, certifications, etc.).

Your task is to populate the form fields. 
- Match standard inputs (name, email, phone, roll number) using the user's profile.
- Match open/rich inputs (summary, description, skills, education, certifications, address) by extracting or summarizing the relevant info generated in our chat history.
- Respond ONLY with a valid JSON object mapping the field index (as a string) to the value. Do not include markdown codeblocks or any extra text.
Example:
{
  "0": "Khush Patel",
  "1": "React, HTML, CSS",
  "2": "108645"
}`;
                
                const fillRequestPrompt = `Here is the list of form fields on the active page: ${JSON.stringify(getFieldsResponse.fields)}. Please map values for these field indices based on our conversation context.`;
                const messagesForLlm = [
                  ...messages.map(m => ({ role: m.role, content: m.content })),
                  { role: 'user', content: fillRequestPrompt }
                ];

                const llmReply = await api.chat(messagesForLlm, { ...appSettings, systemPrompt });
                
                let valuesMap = {};
                try {
                  let cleanJson = llmReply.trim();
                  if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
                  }
                  valuesMap = JSON.parse(cleanJson.trim());
                } catch (jsonErr) {
                  console.error('Failed to parse form filler JSON:', jsonErr, llmReply);
                  const match = llmReply.match(/\{[\s\S]*\}/);
                  if (match) {
                    valuesMap = JSON.parse(match[0]);
                  }
                }

                // 3. Command the content script to fill these index-mapped inputs
                if (Object.keys(valuesMap).length > 0) {
                  const fillResponse = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(tab.id, {
                      type: 'FILL_FORM_VALUES',
                      values: valuesMap
                    }, (res) => {
                      if (chrome.runtime.lastError) resolve(null);
                      else resolve(res);
                    });
                  });
                  if (fillResponse && fillResponse.success) {
                    filledCount = fillResponse.filledCount;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(err);
          errorOccurred = true;
        }

        // Save user message to chat database
        const dbText = imageInput ? `[Uploaded Image: ${imageName}] ${text}` : text;
        const userMsg = await api.saveMessage(currentConvId, 'user', dbText);
        
        let responseText = '';
        if (errorOccurred || typeof chrome === 'undefined' || !chrome.tabs) {
          responseText = `⚠️ I was unable to access the active tab. Please make sure LAKSHYA is running inside the Chrome Extension sidepanel and you have active page permissions.`;
        } else if (filledCount > 0) {
          responseText = `⚡ **Auto-fill complete!** I scanned the active webpage form elements and successfully filled out **${filledCount}** field(s) using your profile and conversation context (including skills, descriptions, and roll number).`;
        } else {
          responseText = `🔍 I scanned the active webpage form elements but could not match or find values for the form fields in our profile or chat history context.`;
        }

        const aiMsg = await api.saveMessage(currentConvId, 'assistant', responseText);
        
        // Refresh message logs in UI view
        const history = await api.getMessages(currentConvId);
        setMessages(history);
        await loadConversations(appSettings);
        setInputValue('');
        
        // Audio read aloud if enabled
        if (appSettings?.audioEnabled) {
          voice.speak(
            responseText.replace(/[⚡⚠️🔍**`]/g, ''),
            appSettings,
            () => console.log('Speaking response...'),
            () => console.log('Response finished.')
          );
        }
        return;
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

      // Reload list to sync title
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

      let assistantResponse = '';
      
      await api.chatStream(
        updatedMessages.map(m => ({ role: m.role, content: m.content })),
        appSettings,
        activeTabContext,
        fileContext,
        activeImage,
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
          <div className="sp-header-actions" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button 
              onClick={handleAutoFillForm}
              className="sp-action-btn fill-form-btn"
              style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', borderColor: '#f59e0b', color: '#d97706' }}
              title="Auto-Fill Form"
            >
              <Zap size={14} fill="#d97706" />
            </button>
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
            title="Conversation"
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
          {attachmentStatus && (
            <div className="sp-attachment-status">
              {uploadingFile ? <RefreshCw className="spin" size={12} /> : <Paperclip size={12} />}
              <span>{attachmentStatus}</span>
            </div>
          )}
          {activeAttachment && (
            <div className="sp-active-attachment">
              {activeAttachment.kind === 'PDF' ? <FileText size={14} /> : <Table size={14} />}
              <div>
                <strong>{activeAttachment.name}</strong>
                <span>{activeAttachment.kind} loaded · {activeAttachment.detail}</span>
              </div>
            </div>
          )}
          {imageInput && (
            <div className="sp-image-preview-container">
              <img src={imageInput} alt="Preview" className="sp-image-preview-thumbnail" />
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            placeholder="Ask LAKSHYA..."
            disabled={!backendOnline}
            className="sp-input-field"
            rows={2}
          />
          <div className="sp-controls">
            <div className="sp-left-controls">
              <button
                type="button"
                onClick={() => setAttachmentMenuOpen(prev => !prev)}
                disabled={uploadingFile || !backendOnline || !appSettings}
                className={`sp-plus-btn ${attachmentMenuOpen ? 'active' : ''}`}
                title="Add file"
              >
                <Plus size={16} />
              </button>
              {attachmentMenuOpen && (
                <div className="sp-attachment-menu">
                  <button type="button" onClick={() => pdfInputRef.current?.click()}>
                    <FileText size={15} />
                    <span>PDF</span>
                  </button>
                  <button type="button" onClick={() => spreadsheetInputRef.current?.click()}>
                    <Table size={15} />
                    <span>Excel / CSV</span>
                  </button>
                </div>
              )}
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handlePdfUpload}
                className="sp-hidden-file"
              />
              <input
                ref={spreadsheetInputRef}
                type="file"
                accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
                onChange={handleSpreadsheetUpload}
                className="sp-hidden-file"
              />
              <button
                type="button"
                onClick={() => document.getElementById('sp-image-file-input').click()}
                disabled={isStreaming || !backendOnline}
                className="sp-plus-btn image-upload-btn-icon"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', minWidth: '28px' }}
                title="Add Image"
              >
                <Camera size={14} />
              </button>
              <input
                type="file"
                id="sp-image-file-input"
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
              disabled={(!inputValue.trim() && !imageInput) || isStreaming || !backendOnline}
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
