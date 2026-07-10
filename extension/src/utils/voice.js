// LAKSHYA - Speech-to-Text (STT) and Text-to-Speech (TTS) Engine

let mediaRecorder = null;
let audioChunks = [];
let activeAudioElement = null; // For external TTS playback
let recognitionInstance = null; // For native Speech Recognition

const voice = {
  // --- Text-to-Speech (TTS) ---
  speak(text, config = {}, onStart = () => {}, onEnd = () => {}, onError = () => {}) {
    this.stopSpeaking();

    const { useExternalVoice = false, apiKey = '', voiceName = 'alloy', voiceRate = 1.0 } = config;

    // Use OpenAI TTS only if useExternalVoice is enabled AND it is a valid OpenAI key (not OpenRouter)
    const isValidOpenAIKey = apiKey && !apiKey.startsWith('sk-or-');
    const shouldRunOpenAITTS = useExternalVoice && isValidOpenAIKey;

    if (shouldRunOpenAITTS) {
      console.log(`Using OpenAI TTS API (Voice: ${voiceName}) to read aloud...`);
      onStart();
      
      fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: voiceName // 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
        })
      })
      .then(res => {
        if (!res.ok) throw new Error('OpenAI TTS API returned error status');
        return res.blob();
      })
      .then(blob => {
        const audioUrl = URL.createObjectURL(blob);
        activeAudioElement = new Audio(audioUrl);
        activeAudioElement.playbackRate = voiceRate;
        
        activeAudioElement.onended = () => {
          URL.revokeObjectURL(audioUrl);
          activeAudioElement = null;
          onEnd();
        };

        activeAudioElement.onerror = (e) => {
          console.error('Audio playback error:', e);
          URL.revokeObjectURL(audioUrl);
          activeAudioElement = null;
          onError(e);
        };

        activeAudioElement.play();
      })
      .catch(err => {
        console.error('OpenAI TTS failed, falling back to Web Speech Synthesis:', err);
        this.speakNative(text, voiceRate, onStart, onEnd, onError);
      });
    } else {
      // Use standard Browser Web Speech API
      this.speakNative(text, voiceRate, onStart, onEnd, onError);
    }
  },

  // Stop any active speech output (both Web Speech and External Audio)
  stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeAudioElement) {
      activeAudioElement.pause();
      activeAudioElement.src = '';
      activeAudioElement = null;
    }
  },

  // Internal: Browser Speech Synthesis
  speakNative(text, rate = 1.0, onStart, onEnd, onError) {
    if (!window.speechSynthesis) {
      console.warn('Speech synthesis not supported in this browser.');
      onError(new Error('Speech synthesis not supported.'));
      return;
    }

    console.log('Using Browser Web Speech Synthesis...');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    
    // Choose a high-quality default voice if available
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en-') && v.name.includes('Google')) 
      || voices.find(v => v.lang.startsWith('en-'))
      || voices[0];
    
    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    utterance.onstart = onStart;
    utterance.onend = onEnd;
    utterance.onerror = (e) => {
      // Chrome cancels speech synthesis if another speech starts, which is normal
      if (e.error !== 'interrupted') {
        console.error('Speech synthesis utterance error:', e);
        onError(e);
      } else {
        onEnd();
      }
    };

    window.speechSynthesis.speak(utterance);
  },

  // --- Speech-to-Text (STT) ---
  // Returns a promise or starts a streaming listener
  startListening(config = {}, onTranscript, onError, onStateChange = () => {}) {
    const { useExternalVoice = false, apiKey = '' } = config;

    // Use Whisper only if explicitly enabled AND we have a valid OpenAI key (not OpenRouter)
    const isValidOpenAIKey = apiKey && !apiKey.startsWith('sk-or-');
    const shouldRunWhisper = useExternalVoice && isValidOpenAIKey;

    if (shouldRunWhisper) {
      console.log('Recording audio for OpenAI Whisper transcription...');
      this.startRecording(onStateChange, async (audioBlob) => {
        onStateChange('transcribing');
        try {
          const transcript = await this.transcribeWithWhisper(audioBlob, apiKey);
          onTranscript(transcript);
        } catch (err) {
          console.error('Whisper transcription failed:', err);
          onError(err);
        } finally {
          onStateChange('idle');
        }
      }, onError);
    } else {
      // Use browser Web Speech API
      this.startListeningNative(onTranscript, onError, onStateChange);
    }
  },

  // Stop active speech recognition or recording
  stopListening() {
    if (recognitionInstance) {
      try {
        recognitionInstance.stop();
      } catch (e) {}
      recognitionInstance = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      mediaRecorder = null;
    }
  },

  // Internal: Browser Speech Recognition
  startListeningNative(onTranscript, onError, onStateChange) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onError(new Error('Speech recognition not supported in this browser.'));
      return;
    }

    this.stopListening();
    
    const recognition = new SpeechRecognition();
    recognitionInstance = recognition;

    recognition.continuous = false;
    recognition.interimResults = true; // Enable real-time transcript updates
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      console.log('Browser speech recognition active.');
      onStateChange('listening');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const activeTranscript = finalTranscript || interimTranscript;
      if (activeTranscript) {
        console.log('Speech recognized (realtime):', activeTranscript);
        onTranscript(activeTranscript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        console.warn('Microphone permission not granted. Opening permission tab...');
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        }
        onError(new Error('Microphone access denied. A permission tab has been opened. Please click "Allow" on the new tab and try again.'));
      } else if (event.error !== 'no-speech') {
        console.error('Speech recognition error:', event.error);
        onError(new Error(`Speech recognition error: ${event.error}`));
      }
    };

    recognition.onend = () => {
      console.log('Speech recognition ended.');
      onStateChange('idle');
      recognitionInstance = null;
    };

    recognition.start();
  },

  // Internal: Micro-recording helper for API Whisper
  async startRecording(onStateChange, onFinished, onError) {
    this.stopListening();
    audioChunks = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        onFinished(audioBlob);
      };

      mediaRecorder.start();
      onStateChange('recording');
      console.log('Media recorder active.');
    } catch (err) {
      console.error('Microphone access denied:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message.includes('denied')) {
        console.warn('Opening permission tab...');
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        }
        onError(new Error('Microphone access denied. A permission tab has been opened. Please click "Allow" on the new tab and try again.'));
      } else {
        onError(new Error('Microphone access denied: ' + err.message));
      }
      onStateChange('idle');
    }
  },

  // Internal: Transcribe via Whisper API
  async transcribeWithWhisper(audioBlob, apiKey) {
    const formData = new FormData();
    // Wrap the blob into a file object so OpenAI accepts it
    const file = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });
    formData.append('file', file);
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    console.log('Sending audio file to OpenAI Whisper...');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Whisper API error: ${err}`);
    }

    const data = await response.json();
    return data.text;
  }
};

export default voice;
