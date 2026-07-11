const MARKETPLACES = {
  flipkart: {
    label: 'Flipkart',
    aliases: ['flipkart', 'flipkart.com'],
    searchUrl: 'https://www.flipkart.com/search',
    queryParam: 'q'
  },
  amazon: {
    label: 'Amazon',
    aliases: ['amazon', 'amazon.in', 'amazon.com'],
    searchUrl: 'https://www.amazon.in/s',
    queryParam: 'k'
  }
};

const MARKETPLACE_PATTERN = Object.values(MARKETPLACES)
  .flatMap(site => site.aliases.map(alias => alias.replace('.', '\\.')))
  .join('|');

function findMarketplace(rawSite = '') {
  const normalizedSite = rawSite.toLowerCase().replace(/^www\./, '');
  return Object.entries(MARKETPLACES).find(([, site]) => (
    site.aliases.some(alias => normalizedSite === alias)
  ))?.[0] || null;
}

function buildSearchUrl(siteKey, query) {
  const site = MARKETPLACES[siteKey];
  return `${site.searchUrl}?${site.queryParam}=${encodeURIComponent(query)}`;
}

function cleanQuery(rawQuery = '') {
  return rawQuery
    .replace(/^["'`]+|["'`.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBrowserAutomationCommand(text = '') {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const openThenSearch = normalized.match(
    new RegExp(`\\b(?:open|launch|go to|visit)\\s+(?:the\\s+)?(${MARKETPLACE_PATTERN})\\b(?:\\s+(?:and|then))?.*?\\b(?:search|find|look\\s+for|show\\s+me)\\b(?:\\s+(?:for|about))?\\s+(.+)$`, 'i')
  );

  const searchOnMarketplace = normalized.match(
    new RegExp(`\\b(?:search|find|look\\s+for|show\\s+me)\\b(?:\\s+(?:for|about))?\\s+(.+?)\\s+(?:on|in)\\s+(?:the\\s+)?(${MARKETPLACE_PATTERN})\\b`, 'i')
  );

  let siteKey = null;
  let query = '';

  if (openThenSearch) {
    siteKey = findMarketplace(openThenSearch[1]);
    query = cleanQuery(openThenSearch[2]);
  } else if (searchOnMarketplace) {
    siteKey = findMarketplace(searchOnMarketplace[2]);
    query = cleanQuery(searchOnMarketplace[1]);
  }

  if (!siteKey) return null;
  if (!query) return null;

  return {
    type: 'marketplace-search',
    site: siteKey,
    siteLabel: MARKETPLACES[siteKey].label,
    query,
    url: buildSearchUrl(siteKey, query)
  };
}

export async function runBrowserAutomationCommand(command) {
  if (!command || command.type !== 'marketplace-search') {
    throw new Error('Unsupported browser automation command.');
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'OPEN_MARKETPLACE_SEARCH', site: command.site, query: command.query },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.success) {
            reject(new Error(response?.error || `Could not open ${command.siteLabel} search.`));
            return;
          }

          resolve(response);
        }
      );
    });
  }

  window.open(command.url, '_blank', 'noopener,noreferrer');
  return { success: true, site: command.site, siteLabel: command.siteLabel, query: command.query, url: command.url };
}
