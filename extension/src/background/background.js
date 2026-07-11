// LAKSHYA - AI Browser Companion Background Worker

// Set up the Side Panel behavior on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('LAKSHYA Extension installed.');
  
  // Enable sidepanel on icon action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Error setting panel behavior:', error));
});

// Listener for runtime messages (e.g. from content script or popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.type === 'GET_ACTIVE_TAB_CONTENT') {
    // Queries the active tab content
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse({ error: 'No active tab found.' });
        return;
      }
      
      const activeTab = tabs[0];
      
      // Inject content script if not already loaded, then request extraction
      chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_PAGE_CONTENT' }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: 'Cannot extract from this page. Ensure it is a web page and not a restricted browser page (e.g. chrome:// or webstore).' });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // Indicates asynchronous response
  }

  if (message.type === 'OPEN_MARKETPLACE_SEARCH' || message.type === 'OPEN_FLIPKART_SEARCH') {
    const query = (message.query || '').trim();
    if (!query) {
      sendResponse({ success: false, error: 'Search query is required.' });
      return true;
    }

    const marketplaces = {
      flipkart: {
        label: 'Flipkart',
        searchUrl: 'https://www.flipkart.com/search',
        queryParam: 'q'
      },
      amazon: {
        label: 'Amazon',
        searchUrl: 'https://www.amazon.in/s',
        queryParam: 'k'
      }
    };

    const siteKey = message.type === 'OPEN_FLIPKART_SEARCH' ? 'flipkart' : message.site;
    const site = marketplaces[siteKey];
    if (!site) {
      sendResponse({ success: false, error: 'Unsupported marketplace.' });
      return true;
    }

    const url = `${site.searchUrl}?${site.queryParam}=${encodeURIComponent(query)}`;
    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ success: true, site: siteKey, siteLabel: site.label, query, url, tabId: tab?.id });
    });
    return true;
  }

  if (message.type === 'OPEN_CUSTOM_URL') {
    const url = (message.url || '').trim();
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      sendResponse({ success: false, error: 'Invalid URL.' });
      return true;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      sendResponse({ success: false, error: 'Only http and https URLs are supported.' });
      return true;
    }

    chrome.tabs.create({ url: parsedUrl.toString() }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ success: true, url: parsedUrl.toString(), tabId: tab?.id });
    });
    return true;
  }

  if (message.type === 'OPEN_SIDEPANEL') {
    chrome.sidePanel.open({ tabId: sender.tab.id })
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('Error opening sidepanel:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'OPEN_SIDEPANEL_WITH_PROMPT') {
    chrome.storage.local.set({ pendingPrompt: message.prompt }, () => {
      chrome.sidePanel.open({ tabId: sender.tab.id })
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('Error opening sidepanel with prompt:', err);
          sendResponse({ success: false, error: err.message });
        });
    });
    return true;
  }
});
