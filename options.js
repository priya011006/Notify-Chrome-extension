// options.js
document.addEventListener('DOMContentLoaded', () => {
  const daily = document.getElementById('dailyReminder');
  const hour = document.getElementById('reminderHour');
  const save = document.getElementById('save');

  chrome.storage.local.get({ settings: { dailyReminderEnabled: true, reminderHourUTC: 1 } }, (data) => {
    const s = data.settings || {};
    daily.checked = s.dailyReminderEnabled !== false;
    hour.value = s.reminderHourUTC ?? 1;
  });

  save.addEventListener('click', () => {
    const settings = {
      dailyReminderEnabled: daily.checked,
      reminderHourUTC: Math.max(0, Math.min(23, parseInt(hour.value || 1)))
    };
    chrome.storage.local.set({ settings }, () => {
      alert('Settings saved.');
    });
  });
});
