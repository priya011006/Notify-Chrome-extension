// ai.js — Gemini summarization helper

// === STEP 1: ADD YOUR GOOGLE GEMINI API KEY HERE ===
// You can generate a key from https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = "";

// === STEP 2: USE THE FUNCTION BELOW TO SUMMARIZE TEXT WITH GEMINI ===

export async function summarizeWithGemini(content) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes()) {
    console.warn("Gemini API key missing in ai.js!");
    return "⚠️ Gemini API key not set. Please update it in ai.js.";
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `Summarize this text clearly in 3-5 sentences:\n\n${content}` },
              ],
            },
          ],
        }),
      }
    );
    const data = await response.json();
    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Summary unavailable (Gemini API error)."
    );
  } catch (err) {
    console.error("Gemini summarization failed:", err);
    return "Could not reach Gemini API.";
  }
}
