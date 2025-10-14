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
  
  // Create alarm to check for scheduled tasks (fires every hour)
  chrome.alarms.create('checkScheduledTasks', { periodInMinutes: 60 });
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
        chrome.storage.local.set({ bookmarks, lastActivity: Date.now() }, () => {
          updateStreakOnSave();
          sendResponse({ success: true, bookmark: updatedBookmark, updated: true });
        });
      } else {
        // Create new bookmark
        const b = { id: getId(), ...msg.payload, createdAt: Date.now() };
        bookmarks.unshift(b);
        // keep max 200 entries
        chrome.storage.local.set({ bookmarks: bookmarks.slice(0, 200), lastActivity: Date.now() }, () => {
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
  } else if (msg.action === 'scheduleTask') {
    // Allow popup to schedule a task and create an alarm
    const task = msg.task;
    if (!task || !task.id || !task.date) return sendResponse({ success: false });
    chrome.storage.local.get({ scheduledTasks: [] }, (data) => {
      const tasks = data.scheduledTasks || [];
      const exists = tasks.find(t => t.id === task.id);
      if (!exists) tasks.push(task);
      chrome.storage.local.set({ scheduledTasks: tasks }, () => {
        // Create an alarm for the day at 9AM local time
        const when = new Date(task.date + 'T09:00:00');
        const ms = when.getTime();
        if (!isNaN(ms) && ms > Date.now()) {
          chrome.alarms.create(`task:${task.id}`, { when: ms });
        }
        sendResponse({ success: true });
      });
    });
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
          notifySimple('Vibrant Progress', 'You haven\'t saved progress recently. Try bookmarking a page or video!');
        } else {
          notifyWithButtons('Vibrant Progress', `You have ${bookmarks.length} saved items. Restore or view them?`, [
            { title: 'Restore All' },
            { title: 'Open List' }
          ]);
        }
      }
    });
  } else if (alarm.name === 'checkScheduledTasks') {
    checkScheduledTasks();
  } else if (alarm.name.startsWith('task:')) {
    const taskId = alarm.name.slice(5);
    chrome.storage.local.get(['scheduledTasks'], (data) => {
      const tasks = data.scheduledTasks || [];
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      notifyWithButtons('Scheduled Task', `🔔 ${task.title}\nDue: ${task.date}`, [
        { title: 'Open Calendar' },
        { title: 'Mark Completed' }
      ], (id) => chrome.storage.local.set({ lastScheduledNotification: id }));
    });
  }
});

// Check for scheduled tasks
function checkScheduledTasks() {
  chrome.storage.local.get(['scheduledTasks'], (data) => {
    const tasks = data.scheduledTasks || [];
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    const todaysTasks = tasks.filter(task => 
      task.date === today && !task.completed
    );
    
    if (todaysTasks.length > 0) {
      let message = `📅 You have ${todaysTasks.length} scheduled task(s) for today:\n\n`;
      todaysTasks.forEach((task, index) => {
        message += `${index + 1}. ${task.title}\n`;
      });
      
      notifyWithButtons('Scheduled Tasks', message, [
        { title: 'View Calendar' },
        { title: 'Mark Complete' }
      ], (id) => chrome.storage.local.set({ lastScheduledNotification: id }));
    }
  });
}

// Notification helpers
function notifySimple(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

function notifyWithButtons(title, message, buttons = [], callback) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon48.png',
    title,
    message,
    buttons
  }, (id) => {
    if (callback) {
      callback(id);
    } else {
      chrome.storage.local.set({ lastNotificationId: id });
    }
  });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, btnIndex) => {
  chrome.storage.local.get(['lastNotificationId', 'lastStartupNotification', 'lastScheduledNotification', 'bookmarks'], (data) => {
    // Handle startup notification
    if (data.lastStartupNotification === notificationId) {
      if (btnIndex === 0) {
        // Open Dashboard - create a new tab with popup content
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      } else if (btnIndex === 1) {
        // Continue Reading - restore all bookmarks
        const bookmarks = data.bookmarks || [];
        bookmarks.forEach(b => chrome.tabs.create({ url: b.url }));
      }
      chrome.notifications.clear(notificationId);
      return;
    }
    
    // Handle scheduled tasks notification
    if (data.lastScheduledNotification === notificationId) {
      if (btnIndex === 0) {
        // View Calendar
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      } else if (btnIndex === 1) {
        // Mark Complete - mark today's tasks as completed
        const today = new Date().toISOString().split('T')[0];
        chrome.storage.local.get(['scheduledTasks'], (taskData) => {
          const tasks = taskData.scheduledTasks || [];
          tasks.forEach(task => {
            if (task.date === today) {
              task.completed = true;
            }
          });
          chrome.storage.local.set({ scheduledTasks: tasks });
        });
      }
      chrome.notifications.clear(notificationId);
      return;
    }
    
    // Handle regular notification
    if (data.lastNotificationId !== notificationId) return;
    if (btnIndex === 0) {
      // Restore all
      const bookmarks = data.bookmarks || [];
      bookmarks.forEach(b => chrome.tabs.create({ url: b.url }));
    } else {
      // Open popup (as a window)
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
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

//new
// === AUTO-INJECT ASSISTANT ON STARTUP ===
chrome.runtime.onStartup.addListener(() => {
  injectAssistantEverywhere();
  // Add a small delay to ensure Chrome is fully loaded
  setTimeout(() => {
    showStartupSummary();
  }, 2000);
});
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") {
    injectAssistantEverywhere();
    showStartupSummary();
  }
});

function injectAssistantEverywhere() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.url && !tab.url.startsWith("chrome://")) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showVibrantAssistantPanel
        });
      }
    }
  });
}

// This function runs inside webpage
function showVibrantAssistantPanel() {
  if (window.__vibrantAssistantInjected) return;
  window.__vibrantAssistantInjected = true;

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("popup.html");
  Object.assign(iframe.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "400px",
    height: "500px",
    border: "none",
    borderRadius: "12px",
    zIndex: "2147483647",
    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    background: "transparent",
    opacity: "0",
    transition: "opacity 0.4s ease, transform 0.4s ease",
    transform: "translateY(20px)"
  });
  document.body.appendChild(iframe);
  setTimeout(() => {
    iframe.style.opacity = "1";
    iframe.style.transform = "translateY(0)";
  }, 200);

  window.addEventListener("message", (e) => {
    if (e.data === "close-vibrant-popup") {
      iframe.style.opacity = "0";
      iframe.style.transform = "translateY(20px)";
      setTimeout(() => iframe.remove(), 400);
    }
  });
}

// === STARTUP SUMMARY POPUP ===
function showStartupSummary() {
  chrome.storage.local.get(['bookmarks', 'lastActivity', 'streak'], (data) => {
    const bookmarks = data.bookmarks || [];
    const lastActivity = data.lastActivity || null;
    const streak = data.streak || 0;
    
    // Create summary content
    let summaryContent = '';
    
    if (bookmarks.length === 0) {
      summaryContent = 'Welcome to Vibrant Progress Tracker! 🎉\n\nStart by saving your first page to track your reading progress.';
    } else {
      const recentBookmarks = bookmarks.slice(0, 3);
      const totalProgress = Math.round(
        bookmarks.reduce((sum, b) => sum + (b.scrollY / (b.docHeight || 1)), 0) / bookmarks.length * 100
      );
      
      summaryContent = `📊 Your Progress Summary\n\n`;
      summaryContent += `📚 Total Saved Pages: ${bookmarks.length}\n`;
      summaryContent += `📈 Average Progress: ${totalProgress}%\n`;
      summaryContent += `🔥 Current Streak: ${streak} day${streak === 1 ? '' : 's'}\n\n`;
      
      if (recentBookmarks.length > 0) {
        summaryContent += `📖 Recent Activity:\n`;
        recentBookmarks.forEach((bookmark, index) => {
          const progress = Math.round((bookmark.scrollY / (bookmark.docHeight || 1)) * 100);
          const title = bookmark.title.length > 30 ? bookmark.title.substring(0, 30) + '...' : bookmark.title;
          summaryContent += `${index + 1}. ${title} (${progress}%)\n`;
        });
      }
      
      if (lastActivity) {
        const lastActivityDate = new Date(lastActivity);
        const timeAgo = getTimeAgo(lastActivityDate);
        summaryContent += `\n⏰ Last Activity: ${timeAgo}`;
      }
    }
    
    // Show notification with summary
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Vibrant Progress Tracker - Daily Summary',
      message: summaryContent,
      buttons: [
        { title: 'Open Dashboard' },
        { title: 'Continue Reading' }
      ]
    }, (notificationId) => {
      chrome.storage.local.set({ lastStartupNotification: notificationId });
    });
  });
}

// Helper function to get time ago
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  return `${diffDays} days ago`;
}
