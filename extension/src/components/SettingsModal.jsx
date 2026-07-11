import React, { useState } from 'react';
import { X, Trash2, ShieldAlert, Key, Link, Settings2, Sparkles, Volume2 } from 'lucide-react';
import api from '../utils/api';

export default function SettingsModal({ currentSettings, onSave, onClose }) {
  const [provider, setProvider] = useState(currentSettings.provider);
  const [apiKey, setApiKey] = useState(currentSettings.apiKey);
  const [lmStudioUrl, setLmStudioUrl] = useState(currentSettings.lmStudioUrl);
  const [systemPrompt, setSystemPrompt] = useState(currentSettings.systemPrompt);
  const [ragEnabled, setRagEnabled] = useState(currentSettings.ragEnabled);
  const [savePdfToDb, setSavePdfToDb] = useState(currentSettings.savePdfToDb || false);
  const [useExternalVoice, setUseExternalVoice] = useState(currentSettings.useExternalVoice);
  const [voiceName, setVoiceName] = useState(currentSettings.voiceName);
  const [voiceRate, setVoiceRate] = useState(currentSettings.voiceRate);
  const [assemblyApiKey, setAssemblyApiKey] = useState(currentSettings.assemblyApiKey || '');
  const [ytExtractionMode, setYtExtractionMode] = useState(currentSettings.ytExtractionMode || 'local');
  const [formProfile, setFormProfile] = useState(currentSettings.formProfile || []);

  const [clearingDb, setClearingDb] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);

  const handleSave = () => {
    onSave({
      provider,
      apiKey,
      lmStudioUrl,
      systemPrompt,
      ragEnabled,
      savePdfToDb,
      useExternalVoice,
      voiceName,
      voiceRate,
      assemblyApiKey,
      ytExtractionMode,
      formProfile
    });
    onClose();
  };

  const handleClearVectorDb = async () => {
    if (!window.confirm('Are you sure you want to permanently clear the Vector Database? This will erase all webpage memories.')) {
      return;
    }
    setClearingDb(true);
    try {
      await api.clearVectorDb();
      setClearSuccess(true);
      setTimeout(() => setClearSuccess(false), 3000);
    } catch (err) {
      alert('Failed to clear Vector DB: ' + err.message);
    } finally {
      setClearingDb(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-card animate-scale-up">
        <div className="modal-header">
          <div className="header-title-wrapper">
            <Settings2 className="header-icon" size={18} />
            <h2>Companion Settings</h2>
          </div>
          <button onClick={onClose} className="close-modal-btn">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* AI Intelligence Provider */}
          <div className="settings-section">
            <h3><Sparkles size={14} className="sec-icon" /> AI Intelligence Provider</h3>
            
            <div className="form-group">
              <label>Model Engine</label>
              <select 
                value={provider} 
                onChange={(e) => setProvider(e.target.value)}
                className="setting-input"
              >
                <option value="local">LM Studio (Local Host)</option>
                <option value="openrouter">OpenRouter (API Cloud)</option>
              </select>
            </div>

            {provider === 'local' ? (
              <div className="form-group">
                <label className="label-icon-wrapper">
                  <Link size={12} /> LM Studio Server Endpoint URL
                </label>
                <input 
                  type="text" 
                  value={lmStudioUrl}
                  onChange={(e) => setLmStudioUrl(e.target.value)}
                  placeholder="http://localhost:1234/v1"
                  className="setting-input"
                />
                <span className="input-tip">Ensure LM Studio server is running on this port and API sharing is enabled.</span>
              </div>
            ) : (
              <div className="form-group">
                <label className="label-icon-wrapper">
                  <Key size={12} /> OpenRouter API Key
                </label>
                <input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  className="setting-input"
                />
                <span className="input-tip">Your API keys are stored locally and never shared.</span>
              </div>
            )}
          </div>

          {/* Prompt Engineering */}
          <div className="settings-section">
            <h3>System Instruction</h3>
            <div className="form-group">
              <textarea 
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                placeholder="You are LAKSHYA..."
                className="setting-textarea"
              />
            </div>
          </div>

          {/* Knowledge Base / Vector DB */}
          <div className="settings-section">
            <h3>Knowledge Base (Vector Database)</h3>
            <div className="form-checkbox-row">
              <label className="checkbox-container">
                <input 
                  type="checkbox"
                  checked={ragEnabled}
                  onChange={(e) => setRagEnabled(e.target.checked)}
                />
                <span className="checkmark"></span>
                Enable Semantic Vector Context (RAG)
              </label>
            </div>
            <div className="form-checkbox-row">
              <label className="checkbox-container">
                <input 
                  type="checkbox"
                  checked={savePdfToDb}
                  onChange={(e) => setSavePdfToDb(e.target.checked)}
                />
                <span className="checkmark"></span>
                Save uploaded PDFs to Database (RAG)
              </label>
            </div>
            <div className="vector-db-actions">
              <button 
                onClick={handleClearVectorDb}
                disabled={clearingDb}
                className="danger-outline-btn"
              >
                <Trash2 size={14} /> 
                {clearingDb ? 'Clearing...' : clearSuccess ? 'Cleared Memory!' : 'Clear Vector DB'}
              </button>
              <span className="input-tip">Clears all memories saved in ChromaDB.</span>
            </div>
          </div>

          {/* Voice Synthesis */}
          <div className="settings-section">
            <h3><Volume2 size={14} className="sec-icon" /> Audio & Voice Settings</h3>
            <div className="form-checkbox-row">
              <label className="checkbox-container">
                <input 
                  type="checkbox"
                  checked={useExternalVoice}
                  onChange={(e) => setUseExternalVoice(e.target.checked)}
                />
                <span className="checkmark"></span>
                Use OpenAI High-Quality Voice (Requires API Key)
              </label>
            </div>

            {useExternalVoice && (
              <>
                {provider !== 'openrouter' && (
                  <div className="form-group">
                    <label className="label-icon-wrapper"><Key size={12} /> OpenAI API Key (For Audio APIs)</label>
                    <input 
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="setting-input"
                    />
                  </div>
                )}
                
                <div className="form-group">
                  <label>OpenAI Voice Model</label>
                  <select 
                    value={voiceName} 
                    onChange={(e) => setVoiceName(e.target.value)}
                    className="setting-input"
                  >
                    <option value="alloy">Alloy (Neutral/Balanced)</option>
                    <option value="echo">Echo (Warm/Mellow)</option>
                    <option value="fable">Fable (Narrative/Expressive)</option>
                    <option value="onyx">Onyx (Deep/Professional)</option>
                    <option value="nova">Nova (Bright/Energetic)</option>
                    <option value="shimmer">Shimmer (Professional/Clear)</option>
                  </select>
                </div>
              </>
            )}

            <div className="form-group">
              <label>Speech Reading Rate: {voiceRate}x</label>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1"
                value={voiceRate}
                onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                className="setting-slider"
              />
            </div>
          </div>

          {/* YouTube Transcription settings */}
          <div className="settings-section">
            <h3><Key size={14} className="sec-icon" /> YouTube Transcription Settings</h3>
            <div className="form-group">
              <label>Transcription Engine</label>
              <select 
                value={ytExtractionMode} 
                onChange={(e) => setYtExtractionMode(e.target.value)}
                className="setting-input"
                style={{ marginBottom: '12px' }}
              >
                <option value="local">Local Caption Scraper (Fast / Free)</option>
                <option value="assembly">AssemblyAI Audio Transcriber (Cloud / High-fidelity)</option>
              </select>
            </div>

            {ytExtractionMode === 'assembly' && (
              <div className="form-group animate-fade-in">
                <label className="label-icon-wrapper">
                  <Key size={12} /> AssemblyAI API Key
                </label>
                <input 
                  type="password" 
                  value={assemblyApiKey}
                  onChange={(e) => setAssemblyApiKey(e.target.value)}
                  placeholder="Enter AssemblyAI API Key"
                  className="setting-input"
                />
                <span className="input-tip">
                  Get a free key from <a href="https://www.assemblyai.com" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>assemblyai.com</a>. AssemblyAI transcribes the full audio stream. Note: public YouTube videos can sometimes be blocked by YouTube rate limits on AssemblyAI's transcribers.
                </span>
              </div>
            )}
          </div>

          {/* Form Filler Variables Profile */}
          <div className="settings-section">
            <h3><Settings2 size={14} className="sec-icon" /> Auto-Fill Profile & Custom Variables</h3>
            <span className="input-tip" style={{ marginBottom: '12px', display: 'block' }}>
              Define variables that LAKSHYA can use to automatically fill out web forms.
            </span>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {formProfile.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    value={item.key} 
                    onChange={(e) => {
                      const updated = [...formProfile];
                      updated[idx].key = e.target.value;
                      setFormProfile(updated);
                    }}
                    placeholder="Variable Key (e.g. rollNo)"
                    className="setting-input"
                    style={{ flex: 1, minWidth: '80px' }}
                  />
                  <input 
                    type="text" 
                    value={item.value} 
                    onChange={(e) => {
                      const updated = [...formProfile];
                      updated[idx].value = e.target.value;
                      setFormProfile(updated);
                    }}
                    placeholder="Value (e.g. 108)"
                    className="setting-input"
                    style={{ flex: 1.5, minWidth: '100px' }}
                  />
                  <button 
                    type="button" 
                    onClick={() => {
                      const updated = formProfile.filter((_, i) => i !== idx);
                      setFormProfile(updated);
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '4px' }}
                    title="Remove Variable"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button 
              type="button" 
              onClick={() => setFormProfile([...formProfile, { key: '', value: '' }])}
              className="btn-secondary"
              style={{ fontSize: '11px', padding: '6px 12px', width: 'fit-content' }}
            >
              + Add Custom Variable
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">Save Settings</button>
        </div>
      </div>
    </div>
  );
}
