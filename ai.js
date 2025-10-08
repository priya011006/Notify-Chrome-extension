// ai.js
// Small, deterministic helper for motivational messages, streak logic, and time-aware greetings.

const AI = (() => {
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

  function getTimeGreeting(date = new Date()) {
    const h = date.getHours();
    if (h < 6) return "Up early — good on you!";
    if (h < 12) return "Good morning! Let's make today count.";
    if (h < 17) return "Good afternoon — keep the momentum.";
    if (h < 21) return "Good evening — nice work today.";
    return "Late-night grind — remember to rest!";
  }

  function getRandomMessage() {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  async function getMotivation() {
    // Combine a time-aware greeting + random message.
    const greeting = getTimeGreeting();
    const msg = getRandomMessage();
    // Optionally include streak info if stored
    const data = await new Promise(resolve => chrome.storage.local.get({ streak: 0 }, resolve));
    const streak = data.streak || 0;
    const streakText = streak > 0 ? `You've kept this up for ${streak} day${streak === 1 ? '' : 's'} — nice!` : '';
    return `${greeting} ${msg} ${streakText}`.trim();
  }

  return { getMotivation };
})();
