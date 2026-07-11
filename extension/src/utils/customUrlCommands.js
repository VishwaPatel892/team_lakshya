const STORAGE_KEY = 'lakshya_custom_url_commands';

function normalizePhrase(value = '') {
  return value
    .toLowerCase()
    .replace(/\bplease\b/g, '')
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9:/._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPhrase(value = '') {
  return value
    .replace(/^["'`\s]+|["'`\s.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractUrl(text = '') {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),.;!?]+$/g, '') : '';
}

function isSafeUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getCurrentTabUrl(activeTabContext) {
  const url = activeTabContext?.url || '';
  return isSafeUrl(url) ? url : '';
}

function levenshteinDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function scorePhraseMatch(input, savedPhrase) {
  const normalizedInput = normalizePhrase(input);
  const normalizedSaved = normalizePhrase(savedPhrase);
  if (!normalizedInput || !normalizedSaved) return 0;

  if (normalizedInput === normalizedSaved) return 1;
  if (normalizedInput.includes(normalizedSaved)) return 0.95;

  const inputTokens = normalizedInput.split(' ');
  const savedTokens = normalizedSaved.split(' ');
  if (inputTokens.length === savedTokens.length) {
    const tokensMatch = savedTokens.every((savedToken, index) => {
      const inputToken = inputTokens[index];
      if (inputToken === savedToken) return true;
      if (savedToken.length < 4 || inputToken.length < 4) return false;

      const distance = levenshteinDistance(inputToken, savedToken);
      const allowedDistance = Math.max(1, Math.floor(Math.max(inputToken.length, savedToken.length) * 0.45));
      return distance <= allowedDistance;
    });

    if (tokensMatch) return 0.82;
  }

  if (normalizedSaved.length >= 8) {
    const distance = levenshteinDistance(normalizedInput, normalizedSaved);
    const maxLength = Math.max(normalizedInput.length, normalizedSaved.length);
    const allowedDistance = Math.max(2, Math.floor(maxLength * 0.3));
    if (distance <= allowedDistance) {
      return 0.85 - distance / Math.max(maxLength, 1);
    }
  }

  return 0;
}

function readStorageValue() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result?.[STORAGE_KEY] || []);
      });
      return;
    }

    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      try {
        resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
      } catch {
        resolve([]);
      }
      return;
    }

    resolve([]);
  });
}

function writeStorageValue(commands) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: commands }, () => resolve(true));
      return;
    }

    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
    }
    resolve(true);
  });
}

export async function getCustomUrlCommands() {
  const commands = await readStorageValue();
  return Array.isArray(commands) ? commands : [];
}

export async function saveCustomUrlCommand(phrase, url) {
  const cleanedPhrase = cleanPhrase(phrase);
  if (!cleanedPhrase) {
    throw new Error('Custom command phrase is required.');
  }
  if (!isSafeUrl(url)) {
    throw new Error('Please provide a valid http or https URL.');
  }

  const commands = await getCustomUrlCommands();
  const normalized = normalizePhrase(cleanedPhrase);
  const existingIndex = commands.findIndex(command => command.normalized === normalized);
  const nextCommand = {
    id: existingIndex >= 0 ? commands[existingIndex].id : `custom_url_${Date.now()}`,
    phrase: cleanedPhrase,
    normalized,
    url,
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    commands[existingIndex] = nextCommand;
  } else {
    commands.push(nextCommand);
  }

  await writeStorageValue(commands);
  return nextCommand;
}

export function parseSaveCustomUrlCommand(text = '', activeTabContext = null) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  const explicitUrl = extractUrl(trimmed);
  const availableUrl = explicitUrl || getCurrentTabUrl(activeTabContext);

  const teachingMatch = trimmed.match(/^(?:when(?:ever)? i say|if i say|on)\s+(.+)$/i);
  if (teachingMatch) {
    const remainingText = explicitUrl
      ? teachingMatch[1].replace(explicitUrl, '').trim()
      : teachingMatch[1].trim();
    const phraseMatch = remainingText.match(
      /^(.*?)\s+(?:then\s+)?(?:open|go to|launch|visit)(?:\s+(?:(?:this|the)\s+)?(?:url|link|site|page))?\s*$/i
    );

    if (!phraseMatch) return null;

    return {
      phrase: cleanPhrase(phraseMatch[1]),
      url: availableUrl,
      needsUrl: !availableUrl
    };
  }

  const setToUrlMatch = trimmed.match(
    /\b(?:save|set|remember)\s+["']?(.+?)["']?\s+(?:as|to|for)\s+(https?:\/\/[^\s"'<>]+)$/i
  );
  if (setToUrlMatch) {
    return {
      phrase: cleanPhrase(setToUrlMatch[1]),
      url: extractUrl(setToUrlMatch[2]),
      needsUrl: false
    };
  }

  const rememberThisUrlMatch = trimmed.match(
    /\b(?:save|remember|set)\s+(?:this|current)\s+(?:url|link|site|page)\s+(?:as|to|for)\s+["']?(.+?)["']?$/i
  );
  if (rememberThisUrlMatch) {
    const currentUrl = getCurrentTabUrl(activeTabContext);
    return {
      phrase: cleanPhrase(rememberThisUrlMatch[1]),
      url: currentUrl,
      needsUrl: !currentUrl
    };
  }

  return null;
}

export async function findCustomUrlCommand(text = '') {
  const commands = await getCustomUrlCommands();
  let bestMatch = null;
  let bestScore = 0;

  for (const command of commands) {
    const score = scorePhraseMatch(text, command.phrase);
    if (score > bestScore) {
      bestMatch = command;
      bestScore = score;
    }
  }

  return bestScore >= 0.68 ? bestMatch : null;
}

export async function openCustomUrlCommand(command) {
  if (!command || !isSafeUrl(command.url)) {
    throw new Error('Saved command has an invalid URL.');
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'OPEN_CUSTOM_URL', url: command.url },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.success) {
            reject(new Error(response?.error || 'Could not open saved URL.'));
            return;
          }

          resolve(response);
        }
      );
    });
  }

  window.open(command.url, '_blank', 'noopener,noreferrer');
  return { success: true, url: command.url };
}
