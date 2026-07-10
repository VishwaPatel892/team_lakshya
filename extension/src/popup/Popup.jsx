import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import settings from '../utils/settings';
import { Bot, Globe, ExternalLink, RefreshCw, BookOpen, AlertCircle } from 'lucide-react';

export default function Popup() {
  const [backendOnline, setBackendOnline] = useState(false);
  const [appSettings, setAppSettings] = useState(null);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    async function init() {
      const config = await settings.getAll();
      setAppSettings(config);
      
      const online = await api.checkStatus();
      setBackendOnline(online);
    }
    init();
  }, []);

  // Quick Summarize Webpage Action
  const handleQuickSummarize = async () => {
    if (!backendOnline || loading) return;

    setLoading(true);
    setSummary('');
    setStatusText('Extracting webpage content...');

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          setLoading(false);
          setStatusText('No active tab found.');
          return;
        }

        const activeTab = tabs[0];
        
        chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_PAGE_CONTENT' }, async (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            setLoading(false);
            setStatusText('Cannot extract content from this page.');
            return;
          }

          setStatusText('Generating summary...');
          try {
            const { title, text, url } = response;
            
            // Format prompt specifically for a quick summary
            const promptMessages = [
              {
                role: 'system',
                content: 'You are LAKSHYA. Provide a concise, bulleted 1-minute summary of the webpage content. Write in a highly readable format.'
              },
              {
                role: 'user',
                content: `Webpage Title: "${title}"\nWebpage Content:\n${text.substring(0, 8000)}\n\nGenerate bullet points for key takeaways.`
              }
            ];

            let generatedSummary = '';
            
            await api.chatStream(
              promptMessages,
              { ...appSettings, ragEnabled: false }, // Direct summarize, bypass RAG
              (chunk) => {
                generatedSummary += chunk;
                setSummary(generatedSummary);
              },
              () => {
                setLoading(false);
                setStatusText('');
              },
              (err) => {
                setLoading(false);
                setStatusText('Failed to generate summary: ' + err.message);
              }
            );
          } catch (error) {
            setLoading(false);
            setStatusText('Error: ' + error.message);
          }
        });
      });
    } else {
      setLoading(false);
      setStatusText('Not in extension sandbox.');
    }
  };

  // Open full dashboard page
  const handleOpenDashboard = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('/index.html', '_blank');
    }
  };

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="popup-header">
        <div className="logo-section">
          <Bot className="logo-icon" size={18} />
          <h2>LAKSHYA</h2>
        </div>
        <div className={`status-pill ${backendOnline ? 'online' : 'offline'}`}>
          {backendOnline ? 'Connected' : 'Offline'}
        </div>
      </div>

      {/* Main Buttons */}
      <div className="popup-body">
        <button 
          onClick={handleQuickSummarize}
          disabled={loading || !backendOnline}
          className={`popup-btn primary-btn ${loading ? 'loading' : ''}`}
        >
          {loading ? (
            <RefreshCw className="spin" size={14} />
          ) : (
            <Globe size={14} />
          )}
          <span>{loading ? statusText : 'Quick Summarize Page'}</span>
        </button>

        <button onClick={handleOpenDashboard} className="popup-btn outline-btn">
          <ExternalLink size={14} />
          <span>Open Full Dashboard</span>
        </button>
      </div>

      {/* Summary Box output */}
      {summary && (
        <div className="popup-summary-box">
          <div className="summary-title-bar">
            <BookOpen size={12} />
            <h3>Page Takeaways</h3>
          </div>
          <div className="summary-content">
            {summary.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Instructions footer */}
      <div className="popup-footer">
        <AlertCircle size={12} className="info-icon" />
        <p>Tip: Right click icon & select <strong>"Pin"</strong>, then click to open side panel for full-page companion chat.</p>
      </div>
    </div>
  );
}
