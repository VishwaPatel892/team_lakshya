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
