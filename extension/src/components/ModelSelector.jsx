import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { RefreshCw, Cpu } from 'lucide-react';

export default function ModelSelector({ settingsConfig, onModelChange }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchModels = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api.getModels(settingsConfig);
      setModels(list);
      
      // If selected model is not in list, auto-select first available model
      if (list.length > 0) {
        const hasActiveModel = list.some(m => m.id === settingsConfig.model);
        if (!hasActiveModel) {
          onModelChange(list[0].id);
        }
      } else {
        setError('No models returned from provider');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (settingsConfig.provider) {
      fetchModels();
    }
  }, [settingsConfig.provider, settingsConfig.apiKey, settingsConfig.lmStudioUrl]);

  return (
    <div className="model-selector-container">
      <div className="selector-wrapper">
        <Cpu className="icon-cpu" size={16} />
        <select
          value={settingsConfig.model || ''}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={loading || models.length === 0}
          className="model-select"
        >
          {loading ? (
            <option>Loading models...</option>
          ) : models.length === 0 ? (
            <option>No models available</option>
          ) : (
            models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))
          )}
        </select>
        <button
          onClick={fetchModels}
          disabled={loading}
          title="Refresh models list"
          className="refresh-btn"
        >
          <RefreshCw className={loading ? 'spin' : ''} size={14} />
        </button>
      </div>
      {error && <div className="model-selector-error">{error}</div>}
    </div>
  );
}
