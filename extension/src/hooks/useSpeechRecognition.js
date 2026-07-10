import { useState, useEffect, useRef } from 'react';

export default function useSpeechRecognition({ onResult, onError, onStateChange }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  // Keep callbacks in refs to avoid rebuilding SpeechRecognition on every render
  const callbacksRef = useRef({ onResult, onError, onStateChange });
  
  useEffect(() => {
    callbacksRef.current = { onResult, onError, onStateChange };
  }, [onResult, onError, onStateChange]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported in this browser.');
      return;
    }

    const rec = new SpeechRecognition();
    recognitionRef.current = rec;

    rec.continuous = false;
    rec.interimResults = true; // Streaming results in real-time
    rec.lang = navigator.language || 'en-US'; // Dynamic language check to avoid loading errors

    rec.onstart = () => {
      setListening(true);
      if (callbacksRef.current.onStateChange) {
        callbacksRef.current.onStateChange('listening');
      }
    };

    rec.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const transcript = finalTranscript || interimTranscript;
      if (callbacksRef.current.onResult && transcript) {
        callbacksRef.current.onResult(transcript, event.results[event.results.length - 1].isFinal);
      }
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed') {
        console.warn('Microphone permission not granted. Opening permission tab...');
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        }
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(new Error('Microphone access denied. A permission tab has been opened. Please click "Allow" on the new tab and try again.'));
        }
      } else if (event.error === 'network') {
        console.error('Speech recognition network error: Google STT server timeout.');
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(new Error('Speech recognition network error: Ensure your microphone is not physically muted, your system volume is turned up, and you have an active internet connection.'));
        }
      } else if (event.error !== 'no-speech') {
        console.error('Speech recognition error:', event.error);
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(new Error(`Speech recognition error: ${event.error}`));
        }
      }
    };

    rec.onend = () => {
      setListening(false);
      if (callbacksRef.current.onStateChange) {
        callbacksRef.current.onStateChange('idle');
      }
    };

    recognitionRef.current = rec;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []); // Stable dependency array -> runs only once on mount!

  const start = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn('Speech recognition already active:', e);
      }
    }
  };

  const stop = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn('Failed to stop speech recognition:', e);
      }
    }
  };

  return { listening, start, stop };
}
