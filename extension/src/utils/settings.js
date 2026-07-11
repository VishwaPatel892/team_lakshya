// LAKSHYA - Settings Management Store

const DEFAULT_SETTINGS = {
  provider: 'local', // 'local' (LM Studio) or 'openrouter'
  apiKey: '', // OpenRouter or OpenAI keys
  lmStudioUrl: 'http://localhost:1234/v1',
  model: '', // Selected LLM model
  systemPrompt: 'You are LAKSHYA, an intelligent AI Browser Companion. Help the user understand webpage contents and answer questions.',
  ragEnabled: true,
  audioEnabled: false,
  useExternalVoice: false,
  voiceName: 'alloy',
  voiceRate: 1.0,
  savePdfToDb: false,
  ytExtractionMode: 'local',
  assemblyApiKey: '',
  formProfile: [
    { key: 'name', value: '' },
    { key: 'email', value: '' },
    { key: 'phone', value: '' },
    { key: 'rollNo', value: '108' }
  ]
};

const settings = {
  // Get all settings
  async getAll() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(null, (result) => {
          resolve({ ...DEFAULT_SETTINGS, ...result });
        });
      } else {
        const local = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          const val = localStorage.getItem(`lakshya_setting_${key}`);
          if (val !== null) {
            local[key] = val === 'true' ? true : val === 'false' ? false : val;
          }
        }
        resolve({ ...DEFAULT_SETTINGS, ...local });
      }
    });
  },

  // Save a single setting
  async set(key, value) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: value }, () => {
          resolve(true);
        });
      } else {
        localStorage.setItem(`lakshya_setting_${key}`, value);
        resolve(true);
      }
    });
  },

  // Save multiple settings
  async setMultiple(settingsObj) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(settingsObj, () => {
          resolve(true);
        });
      } else {
        for (const [key, value] of Object.entries(settingsObj)) {
          localStorage.setItem(`lakshya_setting_${key}`, value);
        }
        resolve(true);
      }
    });
  }
};

export default settings;
export { DEFAULT_SETTINGS };
