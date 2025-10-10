// background.js (service worker)

importScripts(); // noop but indicates this file is the SW

// Default storage shape
const DEFAULTS = {
  bookmarks: [], // each: { id, url, title, scrollY, isYouTube, createdAt }
  lastNotificationId: null,
  settings: {
    dailyReminderEnabled: true,
    reminderHourUTC: 1 // UTC hour to fire reminder (adjust in options)
  },
  streak: 0,
  lastSavedDay: null
};

function getId() {
  return 'bkm-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
}

// Setup context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULTS, (data) => {
    chrome.storage.local.set({ ...DEFAULTS, ...data });
  });

  chrome.contextMenus.create({
    id: 'save-progress',
    title: 'Save progress (Vibrant)',
    contexts: ['page', 'video', 'selection']
  });

  chrome.contextMenus.create({
    id: 'summarize-page',
    title: 'Summarize page (Vibrant)',
    contexts: ['page']
  });

  // Create daily alarm for reminders (fires every 24h)
  chrome.alarms.create('dailyReminder', { periodInMinutes: 24 * 60 });
});

// Context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-progress') {
    // Ask content script to capture state
    chrome.tabs.sendMessage(tab.id, { action: 'captureProgress' }, (resp) => {
      // if content script not injected/allowed, fallback to minimal save
      if (!resp) {
        const b = {
          id: getId(),
          url: tab.url,
          title: tab.title || '',
          scrollY: 0,
          isYouTube: tab.url.includes('youtube.com/watch'),
          createdAt: Date.now()
        };
        chrome.storage.local.get({ bookmarks: [] }, (data) => {
          const bookmarks = data.bookmarks || [];
          bookmarks.unshift(b);
          chrome.storage.local.set({ bookmarks });
          notifySimple('Progress saved', `${b.title || b.url}`);
        });
      }
    });
  } else if (info.menuItemId === 'summarize-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'extractContent' }, (resp) => {
      if (resp && resp.content) {
        // show a notification with a short snippet
        const snippet = resp.content.slice(0, 200) + (resp.content.length > 200 ? '…' : '');
        notifySimple('Page summary (snippet)', snippet);
      } else {
        notifySimple('Summarize', 'Could not extract page content.');
      }
    });
  }
});

// Handle messages from popup/content
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'saveBookmark') {
    chrome.storage.local.get({ bookmarks: [] }, (data) => {
      const bookmarks = data.bookmarks || [];
      // Check if a bookmark with the same URL already exists
      const existingIndex = bookmarks.findIndex(b => b.url.split('#')[0] === msg.payload.url.split('#')[0]);
      
      if (existingIndex >= 0) {
        // Update existing bookmark with new data
        const updatedBookmark = {
          ...bookmarks[existingIndex],
          ...msg.payload,
          updatedAt: Date.now()
        };
        bookmarks[existingIndex] = updatedBookmark;
        chrome.storage.local.set({ bookmarks }, () => {
          updateStreakOnSave();
          sendResponse({ success: true, bookmark: updatedBookmark, updated: true });
        });
      } else {
        // Create new bookmark
        const b = { id: getId(), ...msg.payload, createdAt: Date.now() };
        bookmarks.unshift(b);
        // keep max 200 entries
        chrome.storage.local.set({ bookmarks: bookmarks.slice(0, 200) }, () => {
          // update streak if needed
          updateStreakOnSave();
          sendResponse({ success: true, bookmark: b });
        });
      }
    });
    return true; // async
  } else if (msg.action === 'getMotivation') {
    AI.getMotivation().then((m) => sendResponse({ message: m }));
    return true;
  } else if (msg.action === 'restoreAll') {
    chrome.storage.local.get({ bookmarks: [] }, (data) => {
      const urls = (data.bookmarks || []).map(b => b.url);
      urls.forEach(url => chrome.tabs.create({ url }));
      sendResponse({ opened: urls.length });
    });
    return true;
  } else if (msg.action === 'clearBookmarks') {
    chrome.storage.local.set({ bookmarks: [] }, () => sendResponse({ success: true }));
    return true;
  }
});

// Alarms: daily reminder / cleanups
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReminder') {
    chrome.storage.local.get(['bookmarks', 'settings'], (data) => {
      const settings = data.settings || DEFAULTS.settings;
      if (settings.dailyReminderEnabled) {
        const bookmarks = data.bookmarks || [];
        if (bookmarks.length === 0) {
          // gentle nudge
          notifySimple('Vibrant Progress', 'You haven’t saved progress recently. Try bookmarking a page or video!');
        } else {
          notifyWithButtons('Vibrant Progress', `You have ${bookmarks.length} saved items. Restore or view them?`, [
            { title: 'Restore All' },
            { title: 'Open List' }
          ]);
        }
      }
    });
  }
});

// Notification helpers
function notifySimple(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

function notifyWithButtons(title, message, buttons = []) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    buttons
  }, (id) => chrome.storage.local.set({ lastNotificationId: id }));
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, btnIndex) => {
  chrome.storage.local.get(['lastNotificationId', 'bookmarks'], (data) => {
    if (data.lastNotificationId !== notificationId) return;
    if (btnIndex === 0) {
      // Restore all
      const bookmarks = data.bookmarks || [];
      bookmarks.forEach(b => chrome.tabs.create({ url: b.url }));
    } else {
      // Open popup (as a window)
      chrome.action.openPopup();
    }
    chrome.notifications.clear(notificationId);
  });
});

// Utility: update streak (simple daily streak)
function updateStreakOnSave() {
  chrome.storage.local.get(['lastSavedDay', 'streak'], (data) => {
    const lastSaved = data.lastSavedDay || null;
    const today = new Date().toISOString().slice(0, 10);
    let streak = data.streak || 0;
    if (lastSaved === today) return; // already saved today
    if (lastSaved === new Date(Date.now() - 86400000).toISOString().slice(0, 10)) {
      streak = (streak || 0) + 1;
    } else {
      streak = 1;
    }
    chrome.storage.local.set({ lastSavedDay: today, streak });
  });
}

// Lightweight import of the AI helper defined in ai.js (in MV3 service worker we can't dynamic import local file easily)
// We'll access AI via messages: use chrome.runtime.getURL to inject ai.js into pages if needed
// But we can also include a minimal copy here:
const AI = {
  getMotivation: async () => {
    const messages = [
      "Keep going! You can do it!",
      "Almost there — stay focused!",
      "Every step counts!",
      "You're making great progress!",
      "Don't give up, success is near!",
      "Believe in yourself!",
      "The only way to do great work is to love what you do.",
      "Your effort today builds your success tomorrow."
    ];
    const greeting = (() => {
      const h = new Date().getHours();
      if (h < 6) return "Up early — good on you!";
      if (h < 12) return "Good morning! Let's make today count.";
      if (h < 17) return "Good afternoon — keep the momentum.";
      if (h < 21) return "Good evening — nice work today.";
      return "Late-night grind — remember to rest!";
    })();
    const msg = messages[Math.floor(Math.random() * messages.length)];
    const data = await new Promise(resolve => chrome.storage.local.get({ streak: 0 }, resolve));
    const streak = data.streak || 0;
    const streakText = streak > 0 ? `You've kept this up for ${streak} day${streak === 1 ? '' : 's'} — nice!` : '';
    return `${greeting} ${msg} ${streakText}`.trim();
  }
};