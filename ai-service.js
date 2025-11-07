// AI Service Module for Chrome Built-in AI APIs
// This module provides a unified interface for all Chrome Built-in AI APIs

class ChromeAIService {
  constructor() {
    this.isAvailable = false;
    this.checkAvailability();
  }

  // Check if Chrome Built-in AI APIs are available
  async checkAvailability() {
    try {
      // Check if the AI APIs are available in the current Chrome version
      if (typeof chrome !== 'undefined' && chrome.ai) {
        this.isAvailable = true;
        console.log('Chrome Built-in AI APIs are available');
      } else {
        console.warn('Chrome Built-in AI APIs are not available. Please enable experimental features.');
        this.isAvailable = false;
      }
    } catch (error) {
      console.error('Error checking AI availability:', error);
      this.isAvailable = false;
    }
  }

  // Show permission guidance to user
  showPermissionGuidance() {
    const guidance = `
      Chrome Built-in AI APIs require experimental features to be enabled.
      
      To enable:
      1. Open Chrome Settings (chrome://settings/)
      2. Go to "Privacy and security" → "Site Settings"
      3. Enable "Experimental AI features" or "Built-in AI"
      4. Restart Chrome
      
      Alternatively, you can:
      1. Go to chrome://flags/
      2. Search for "AI" or "Built-in AI"
      3. Enable the relevant flags
      4. Restart Chrome
    `;
    
    return {
      showDialog: true,
      title: 'Enable Chrome Built-in AI APIs',
      message: guidance,
      actions: [
        { text: 'Open Chrome Settings', action: 'openSettings' },
        { text: 'Open Chrome Flags', action: 'openFlags' },
        { text: 'Close', action: 'close' }
      ]
    };
  }

  // Prompt API - Generate dynamic user prompts and structured outputs
  async generatePrompt(prompt, options = {}) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const result = await chrome.ai.prompt({
        prompt: prompt,
        maxTokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7,
        multimodal: options.multimodal || false,
        structuredOutput: options.structuredOutput || false
      });
      
      return {
        success: true,
        content: result.content,
        usage: result.usage
      };
    } catch (error) {
      console.error('Prompt API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Proofreader API - Correct grammar mistakes
  async correctGrammar(text, options = {}) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const result = await chrome.ai.proofreader({
        text: text,
        language: options.language || 'en',
        suggestions: options.suggestions || true
      });
      
      return {
        success: true,
        correctedText: result.correctedText,
        suggestions: result.suggestions || [],
        changes: result.changes || []
      };
    } catch (error) {
      console.error('Proofreader API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Summarizer API - Distill complex information into clear insights
  async summarizeContent(content, options = {}) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const result = await chrome.ai.summarizer({
        content: content,
        maxLength: options.maxLength || 200,
        style: options.style || 'concise', // concise, detailed, bullet-points
        language: options.language || 'en'
      });
      
      return {
        success: true,
        summary: result.summary,
        keyPoints: result.keyPoints || [],
        confidence: result.confidence || 0
      };
    } catch (error) {
      console.error('Summarizer API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Translator API - Add multilingual capabilities
  async translateText(text, targetLanguage, options = {}) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const result = await chrome.ai.translator({
        text: text,
        targetLanguage: targetLanguage,
        sourceLanguage: options.sourceLanguage || 'auto',
        preserveFormatting: options.preserveFormatting || true
      });
      
      return {
        success: true,
        translatedText: result.translatedText,
        sourceLanguage: result.detectedSourceLanguage,
        confidence: result.confidence || 0
      };
    } catch (error) {
      console.error('Translator API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Writer API - Create original and engaging text
  async generateContent(prompt, options = {}) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const result = await chrome.ai.writer({
        prompt: prompt,
        style: options.style || 'professional', // professional, casual, creative, academic
        length: options.length || 'medium', // short, medium, long
        language: options.language || 'en',
        tone: options.tone || 'neutral' // neutral, formal, friendly, persuasive
      });
      
      return {
        success: true,
        content: result.content,
        suggestions: result.suggestions || [],
        alternatives: result.alternatives || []
      };
    } catch (error) {
      console.error('Writer API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Rewriter API - Improve content with alternative options
  async improveContent(text, options = {}) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const result = await chrome.ai.rewriter({
        text: text,
        improvement: options.improvement || 'general', // general, clarity, conciseness, engagement
        style: options.style || 'maintain', // maintain, formal, casual, creative
        language: options.language || 'en'
      });
      
      return {
        success: true,
        improvedText: result.improvedText,
        alternatives: result.alternatives || [],
        changes: result.changes || [],
        suggestions: result.suggestions || []
      };
    } catch (error) {
      console.error('Rewriter API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Utility method to check if a specific API is available
  async checkAPIAvailability(apiName) {
    if (!this.isAvailable) return false;
    
    try {
      const apis = await chrome.ai.getAvailableAPIs();
      return apis.includes(apiName);
    } catch (error) {
      console.error('Error checking API availability:', error);
      return false;
    }
  }

  // Get available languages for translation
  async getSupportedLanguages() {
    if (!this.isAvailable) {
      return { success: false, error: 'Chrome Built-in AI APIs are not available' };
    }

    try {
      const languages = await chrome.ai.translator.getSupportedLanguages();
      return {
        success: true,
        languages: languages
      };
    } catch (error) {
      console.error('Error getting supported languages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Batch processing for multiple operations
  async batchProcess(operations) {
    if (!this.isAvailable) {
      throw new Error('Chrome Built-in AI APIs are not available');
    }

    try {
      const results = await Promise.allSettled(
        operations.map(async (op) => {
          switch (op.type) {
            case 'summarize':
              return await this.summarizeContent(op.content, op.options);
            case 'translate':
              return await this.translateText(op.text, op.targetLanguage, op.options);
            case 'proofread':
              return await this.correctGrammar(op.text, op.options);
            case 'rewrite':
              return await this.improveContent(op.text, op.options);
            case 'generate':
              return await this.generateContent(op.prompt, op.options);
            default:
              throw new Error(`Unknown operation type: ${op.type}`);
          }
        })
      );

      return {
        success: true,
        results: results.map((result, index) => ({
          index,
          success: result.status === 'fulfilled',
          data: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? result.reason.message : null
        }))
      };
    } catch (error) {
      console.error('Batch processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Create global instance
const chromeAIService = new ChromeAIService();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChromeAIService;
} else if (typeof window !== 'undefined') {
  window.ChromeAIService = ChromeAIService;
  window.chromeAIService = chromeAIService;
}

