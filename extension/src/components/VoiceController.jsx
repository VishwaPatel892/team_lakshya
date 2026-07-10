import React, { useState, useEffect } from 'react';
import voice from '../utils/voice';
import useSpeechRecognition from '../hooks/useSpeechRecognition';
import { Mic, Square } from 'lucide-react';

export default function VoiceController({ settingsConfig, onSpeechInput, isAssistantStreaming, stopSignal = 0 }) {
  const [listeningState, setListeningState] = useState('idle'); // 'idle', 'listening', 'recording', 'transcribing'
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');

  const { listening, start, stop } = useSpeechRecognition({
    onResult: (transcript, isFinal) => {
      if (transcript && transcript.trim()) {
        onSpeechInput(transcript);
      }
    },
    onError: (err) => {
      console.error('STT Error:', err);
      setError(err.message || 'Voice recognition failed');
      setListeningState('idle');
    },
    onStateChange: (state) => {
      setListeningState(state);
    }
  });

  // Stop listening/speaking on unmount
  useEffect(() => {
    return () => {
      stop();
      voice.stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (stopSignal > 0) {
      stop();
      setListeningState('idle');
    }
  }, [stopSignal]);

  const handleToggleListen = () => {
    setError('');
    
    if (listeningState !== 'idle') {
      stop();
      setListeningState('idle');
      return;
    }

    voice.stopSpeaking();
    setSpeaking(false);

    try {
      start();
    } catch (err) {
      setError(err.message || 'Could not start voice recognition');
    }
  };

  const handleStopSpeaking = () => {
    voice.stopSpeaking();
    setSpeaking(false);
  };

  const getMicColor = () => {
    switch (listeningState) {
      case 'listening': return 'mic-active-listening';
      case 'recording': return 'mic-active-recording';
      case 'transcribing': return 'mic-active-transcribing';
      default: return '';
    }
  };

  const getMicLabel = () => {
    switch (listeningState) {
      case 'listening': return 'Listening...';
      case 'recording': return 'Recording...';
      case 'transcribing': return 'Processing audio...';
      default: return 'Talk to AI';
    }
  };

  return (
    <div className="voice-controller">
      <div className="voice-buttons">
        <button
          onClick={handleToggleListen}
          disabled={isAssistantStreaming}
          className={`voice-btn mic-btn ${getMicColor()}`}
          title={getMicLabel()}
        >
          {listeningState !== 'idle' ? (
            <Square size={18} className="stop-icon" />
          ) : (
            <Mic size={18} />
          )}
        </button>

        {speaking && (
          <button
            onClick={handleStopSpeaking}
            className="voice-btn speak-stop-btn active"
            title="Stop Reading Aloud"
          >
            <Square size={16} />
          </button>
        )}
      </div>

      {listeningState !== 'idle' && (
        <div className="voice-status-indicator">
          <div className="pulse-waveform">
            <span className="wave-bar"></span>
            <span className="wave-bar"></span>
            <span className="wave-bar"></span>
            <span className="wave-bar"></span>
            <span className="wave-bar"></span>
          </div>
          <span className="status-text">{getMicLabel()}</span>
        </div>
      )}

      {error && <div className="voice-error">{error}</div>}
    </div>
  );
}
