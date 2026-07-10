// LAKSHYA AI Browser Companion Content Script
import { Readability } from '@mozilla/readability';

console.log('LAKSHYA content script active on page:', window.location.href);

// Listen for messages from popup, sidepanel, or background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE_CONTENT') {
    try {
      // Clone the document to avoid messing up the active webpage DOM
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (article) {
        sendResponse({
          success: true,
          title: article.title || document.title,
          text: article.textContent || document.body.innerText,
          excerpt: article.excerpt || '',
          url: window.location.href,
          byline: article.byline || ''
        });
      } else {
        // Fallback if Readability fails to parse a clean article
        sendResponse({
          success: true,
          title: document.title,
          text: document.body.innerText,
          excerpt: '',
          url: window.location.href,
          byline: ''
        });
      }
    } catch (error) {
      console.error('LAKSHYA readability parsing failed:', error);
      sendResponse({
        success: false,
        error: `DOM parsing failed: ${error.message}`,
        text: document.body.innerText, // Final fallback
        url: window.location.href,
        title: document.title
      });
    }
  }

  else if (message.type === 'GET_SELECTED_TEXT') {
    try {
      const selectedText = window.getSelection().toString().trim();
      sendResponse({ success: true, selectedText });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  
  return true; // Keep channel open for async responses
});

// --- LAKSHYA Floating Action Button (FAB) & Selection Tooltip Injection ---

// Only run on top-level windows to avoid loading inside frame blocks/ads
if (window.top === window) {
  // 1. Inject Styles
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    #lakshya-fab {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      width: 46px !important;
      height: 46px !important;
      border-radius: 50% !important;
      background: linear-gradient(135deg, #06b6d4 0%, #6366f1 100%) !important;
      cursor: pointer !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 4px 16px rgba(6, 182, 212, 0.4) !important;
      border: 2px solid rgba(255, 255, 255, 0.25) !important;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease !important;
      color: white !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    #lakshya-fab:hover {
      transform: scale(1.1) !important;
      box-shadow: 0 6px 20px rgba(6, 182, 212, 0.6) !important;
    }
    #lakshya-fab:active {
      transform: scale(0.95) !important;
    }
    #lakshya-fab svg {
      width: 22px !important;
      height: 22px !important;
      stroke: white !important;
      display: block !important;
    }

    #lakshya-selection-tooltip {
      position: absolute !important;
      background: #12141c !important;
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      border-radius: 8px !important;
      padding: 6px 12px !important;
      z-index: 2147483646 !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5) !important;
      display: none;
      align-items: center !important;
      gap: 6px !important;
      cursor: pointer !important;
      color: #f3f4f6 !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      pointer-events: auto !important;
      user-select: none !important;
      transition: opacity 0.15s ease, transform 0.15s ease !important;
      opacity: 0;
      transform: scale(0.9) !important;
      margin: 0 !important;
    }
    #lakshya-selection-tooltip.show {
      opacity: 1 !important;
      transform: scale(1) !important;
    }
    #lakshya-selection-tooltip:hover {
      background: #191c28 !important;
      border-color: #06b6d4 !important;
      box-shadow: 0 0 10px rgba(6, 182, 212, 0.2) !important;
    }
    #lakshya-selection-tooltip svg {
      width: 12px !important;
      height: 12px !important;
      stroke: #06b6d4 !important;
      display: block !important;
    }
  `;
  document.head.appendChild(styleEl);

  // 2. Create Floating Action Button (FAB)
  const fab = document.createElement('div');
  fab.id = 'lakshya-fab';
  fab.title = 'Open LAKSHYA Companion';
  fab.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
  `;
  document.body.appendChild(fab);

  fab.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
  });

  // 3. Create Inline Selection Tooltip
  const tooltip = document.createElement('div');
  tooltip.id = 'lakshya-selection-tooltip';
  tooltip.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
    <span>Ask LAKSHYA</span>
  `;
  document.body.appendChild(tooltip);

  let selectedText = '';

  // Listen for selection changes on mouseup
  document.addEventListener('mouseup', (e) => {
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length > 2) {
        selectedText = text;
        
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          const tooltipWidth = 110;
          const tooltipHeight = 32;
          
          // Compute coordinates
          const top = rect.top + window.scrollY - tooltipHeight - 8;
          const left = rect.left + window.scrollX + (rect.width / 2) - (tooltipWidth / 2);
          
          tooltip.style.top = `${top}px`;
          tooltip.style.left = `${left}px`;
          tooltip.style.display = 'flex';
          
          // Force layout recalculation for transition trigger
          void tooltip.offsetWidth;
          tooltip.classList.add('show');
        } catch (err) {
          // Ignore invalid selection ranges
        }
      } else {
        // Clear if clicked elsewhere
        if (e.target !== tooltip && !tooltip.contains(e.target)) {
          hideTooltip();
        }
      }
    }, 40);
  });

  // Hide tooltip helper
  function hideTooltip() {
    tooltip.classList.remove('show');
    setTimeout(() => {
      if (!tooltip.classList.contains('show')) {
        tooltip.style.display = 'none';
      }
    }, 150);
  }

  // Handle tooltip click
  tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTooltip();
    
    if (selectedText) {
      chrome.runtime.sendMessage({
        type: 'OPEN_SIDEPANEL_WITH_PROMPT',
        prompt: `Explain this selected text:\n"${selectedText}"`
      });
      // Clear selection ranges
      window.getSelection().removeAllRanges();
      selectedText = '';
    }
  });
}
