// content.js - runs in page context

// Utilities
function getScrollPosition() {
  return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
}

function getYouTubeTranscriptSnippet() {
  // Limited heuristic: try to find subtitle elements; best is to use YouTube API
  try {
    const captions = Array.from(document.querySelectorAll('.caption-window, .ytp-caption-segment'));
    if (captions.length) {
      return captions.slice(0, 5).map(c => c.textContent).join(' ');
    }
  } catch (e) {}
  return '';
}

// Basic readable text extraction
function extractMainText(maxChars = 4000) {
  // Attempt to use document.querySelector('article') or main
  const selectors = ['article', 'main', 'section', '#content', 'body'];
  let text = '';
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el && el.innerText && el.innerText.length > 200) {
      text = el.innerText;
      break;
    }
  }
  if (!text) {
    // fallback to walking body text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const parts = [];
    let node;
    while (node = walker.nextNode()) {
      const parentTag = node.parentElement && node.parentElement.tagName;
      if (parentTag === 'SCRIPT' || parentTag === 'STYLE' || parentTag === 'NOSCRIPT') continue;
      const t = node.textContent.trim();
      if (t.length > 20) parts.push(t);
      if (parts.length > 200) break;
    }
    text = parts.join(' ');
  }
  // sanitize and limit
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return 'Content too short for summarization.';
  return text.slice(0, maxChars);
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    const urlObj = new URL(window.location.href);
    const isYouTube = urlObj.hostname.includes('youtube.com') && urlObj.pathname === '/watch';
    let content = '';
    if (isYouTube) {
      const title = document.querySelector('h1.title yt-formatted-string')?.textContent || document.title;
      const description = document.querySelector('#description')?.innerText || '';
      const transcriptSnippet = getYouTubeTranscriptSnippet();
      content = `${title}\n\nDescription: ${description}\n\nTranscript Snippet: ${transcriptSnippet}`.substring(0, 4000);
      if (content.trim().length < 50) content = extractMainText(4000);
    } else {
      content = extractMainText(4000);
    }
    sendResponse({ content });
  } else if (request.action === 'captureProgress') {
    // gather metadata and send back to background/popup
    const payload = {
      url: window.location.href,
      title: document.title || '',
      scrollY: getScrollPosition(),
      isYouTube: window.location.href.includes('youtube.com/watch')
    };
    // Send to background to store
    chrome.runtime.sendMessage({ action: 'saveBookmark', payload }, (resp) => {
      sendResponse(resp);
    });
    return true;
  }
  return undefined;
});

// === 📘 Reading Marker Overlay ===
(function initBookmarkMarker() {
  // Wait until the document is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMarker);
  } else {
    initMarker();
  }

  async function initMarker() {
    const { currentReading } = await chrome.storage.local.get("currentReading");
    if (!currentReading) return;

    // Relaxed match: check if this page starts with the saved URL
    const currentUrl = window.location.href.split("#")[0];
    if (!currentUrl.startsWith(currentReading.url.split("#")[0])) return;

    // Avoid adding twice
    if (document.getElementById("vibrant-reading-marker")) return;

    // Create marker button
    const marker = document.createElement("div");
    marker.id = "vibrant-reading-marker";
    marker.textContent = "📘 Jump to saved position";
    Object.assign(marker.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      background: "#0072ff",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "10px",
      zIndex: 999999,
      cursor: "pointer",
      boxShadow: "0 3px 10px rgba(0,0,0,0.3)",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      transition: "opacity 0.5s ease"
    });

    document.body.appendChild(marker);

    marker.addEventListener("click", () => {
      const y = currentReading.scrollY || 0;
      window.scrollTo({ top: y, behavior: "smooth" });
      marker.textContent = "✅ Scrolled to saved position";
      setTimeout(() => marker.remove(), 3000);
    });

    // Optional auto-hide after 10s
    setTimeout(() => {
      if (document.body.contains(marker)) {
        marker.style.opacity = "0";
        setTimeout(() => marker.remove(), 1000);
      }
    }, 10000);

    // Remove flag after showing so it doesn't reappear unnecessarily
    chrome.storage.local.remove("currentReading");
  }
})();

// === 📊 Live Scroll Tracking ===
(function initLiveProgressTracker() {
  let tracking = false;
  let trackerBar = null;
  let currentUrl = window.location.href.split("#")[0];

  chrome.storage.local.get({ bookmarks: [] }, (data) => {
    const bookmark = (data.bookmarks || []).find(b => currentUrl.startsWith(b.url.split("#")[0]));
    if (!bookmark) return;

    // Create small floating tracker
    trackerBar = document.createElement("div");
    trackerBar.id = "vibrant-live-tracker";
    Object.assign(trackerBar.style, {
      position: "fixed",
      bottom: "18px",
      right: "18px",
      width: "160px",
      height: "8px",
      background: "rgba(255,255,255,0.15)",
      borderRadius: "8px",
      overflow: "hidden",
      zIndex: 999999,
      boxShadow: "0 0 8px rgba(0,0,0,0.4)",
      transition: "opacity 0.3s ease",
      cursor: "pointer"
    });

    const fill = document.createElement("div");
    Object.assign(fill.style, {
      width: "0%",
      height: "100%",
      background: "linear-gradient(90deg, #00c6ff, #00ffcc)",
      transition: "width 0.3s ease"
    });
    trackerBar.appendChild(fill);
    document.body.appendChild(trackerBar);

    tracking = true;
    updateBar();

    window.addEventListener("scroll", () => {
      if (!tracking) return;
      updateBar(true);
    });

    function updateBar(save = false) {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = Math.min((scrollTop / docHeight) * 100, 100);
      fill.style.width = `${progress}%`;

      if (save) {
        // Save scroll progress every few seconds
        throttleSave(progress);
      }
    }

    let saveTimeout = null;
    function throttleSave() {
      if (saveTimeout) return;
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        chrome.storage.local.get({ bookmarks: [] }, (d) => {
          const all = d.bookmarks || [];
          const idx = all.findIndex(b => b.url.split("#")[0] === currentUrl);
          if (idx >= 0) {
            all[idx].scrollY = window.scrollY || 0;
            chrome.storage.local.set({ bookmarks: all });
          }
        });
      }, 1500);
    }
  });
})();
