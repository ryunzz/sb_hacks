/**
 * Vision Agent - Background Service Worker
 * Replaces the Express server for Chrome Extension
 */

import { GoogleGenerativeAI } from './lib/generative-ai.js';

// State management
let conversationHistory = [];
let geminiClient = null;
let config = {
    geminiApiKey: '',
    deepgramApiKey: ''
};

// Initialize on installation
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Vision Agent installed');

    // Load saved API keys
    const stored = await chrome.storage.local.get(['geminiApiKey', 'deepgramApiKey']);
    config.geminiApiKey = stored.geminiApiKey || '';
    config.deepgramApiKey = stored.deepgramApiKey || '';

    if (config.geminiApiKey) {
        initGemini();
    }

    // Open side panel when extension icon is clicked
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
});

// Initialize Gemini client
function initGemini() {
    if (!config.geminiApiKey) return;

    try {
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        geminiClient = {
            model: genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' }),
            visionModel: genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })
        };
        console.log('Gemini initialized');
    } catch (error) {
        console.error('Failed to initialize Gemini:', error);
    }
}

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message.type);

    switch (message.type) {
        case 'message':
            handleUserMessage(message.content).then(sendResponse);
            return true; // Will respond asynchronously

        case 'describe':
            describeActiveTab().then(sendResponse);
            return true;

        case 'screenshot':
            captureActiveTab().then(sendResponse);
            return true;

        case 'config_updated':
            updateConfig(message.config).then(() => {
                sendResponse({ success: true });
            });
            return true;

        default:
            sendResponse({ error: 'Unknown message type' });
    }
});

/**
 * Update configuration (API keys)
 */
async function updateConfig(newConfig) {
    config = { ...config, ...newConfig };
    await chrome.storage.local.set(config);

    if (config.geminiApiKey) {
        initGemini();
    }
}

/**
 * Handle user message
 */
async function handleUserMessage(userInput) {
    if (!geminiClient) {
        return {
            type: 'error',
            message: 'Please configure your API keys in the extension options.'
        };
    }

    try {
        // Add to history
        conversationHistory.push({
            role: 'user',
            content: userInput
        });

        // Check if this is an action request
        const lowerInput = userInput.toLowerCase();
        const isAction =
            lowerInput.includes('go to') ||
            lowerInput.includes('click') ||
            lowerInput.includes('type') ||
            lowerInput.includes('scroll') ||
            lowerInput.includes('navigate') ||
            lowerInput.includes('open');

        if (isAction) {
            return await handleActionRequest(userInput);
        } else if (
            lowerInput.includes('screen') ||
            lowerInput.includes('see') ||
            lowerInput.includes('page')
        ) {
            return await describeActiveTab(userInput);
        } else {
            return await chat(userInput);
        }
    } catch (error) {
        console.error('Error handling message:', error);
        return {
            type: 'error',
            message: 'I encountered an error. Please try again.'
        };
    }
}

/**
 * Chat with Gemini
 */
async function chat(message) {
    const systemPrompt = `You are a friendly, helpful AI assistant designed specifically to help blind and low-vision users navigate the internet and their computer. 

Your personality:
- Warm, patient, and encouraging
- Clear and concise in your responses
- Proactive in offering help
- Natural conversational tone

Keep responses brief but friendly - remember the user is listening, not reading.`;

    try {
        const chat = geminiClient.model.startChat({
            history: conversationHistory.slice(0, -1).map(h => ({
                role: h.role,
                parts: [{ text: h.content }]
            })),
            systemInstruction: systemPrompt
        });

        const result = await chat.sendMessage(message);
        const response = result.response.text();

        conversationHistory.push({
            role: 'assistant',
            content: response
        });

        return {
            type: 'response',
            message: response
        };
    } catch (error) {
        console.error('Chat error:', error);
        throw error;
    }
}

/**
 * Capture and describe active tab
 */
async function describeActiveTab(question = null) {
    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            throw new Error('No active tab found');
        }

        // Capture screenshot
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png'
        });

        // Convert data URL to base64
        const base64 = dataUrl.split(',')[1];

        // Analyze with Gemini
        const prompt = question || `You are an accessibility assistant for blind and low-vision users. 
Describe this screen in a clear, concise way that helps the user understand:
1. What website or application is shown
2. The main content and purpose of the current view
3. Any interactive elements (buttons, links, forms) and their locations
4. Any important notifications or status messages

Be conversational but efficient. Prioritize actionable information.`;

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType: 'image/png'
            }
        };

        const result = await geminiClient.visionModel.generateContent([prompt, imagePart]);
        const description = result.response.text();

        return {
            type: 'response',
            message: description
        };
    } catch (error) {
        console.error('Describe error:', error);
        return {
            type: 'error',
            message: "I couldn't see your screen. Please try again."
        };
    }
}

/**
 * Capture active tab screenshot
 */
async function captureActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png'
        });

        return {
            type: 'screenshot',
            image: dataUrl.split(',')[1]
        };
    } catch (error) {
        console.error('Screenshot error:', error);
        return {
            type: 'error',
            message: 'Could not capture screenshot'
        };
    }
}

/**
 * Handle action requests (navigate, click, type, etc.)
 */
async function handleActionRequest(instruction) {
    try {
        // Get current tab screenshot for context
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        const base64 = dataUrl.split(',')[1];

        // Plan the action with Gemini
        const prompt = `You are a web automation agent. Given the user's instruction and the current screen, output a JSON action plan.

User instruction: ${instruction}

Output a JSON object with this structure:
{
  "understood": true/false,
  "explanation": "Brief explanation of what you'll do",
  "actions": [
    {
      "type": "navigate" | "click" | "type" | "scroll",
      "target": "URL or selector or text",
      "description": "What this action does"
    }
  ],
  "needsMoreInfo": "Question to ask if unclear, or null"
}

Only output valid JSON, no markdown.`;

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType: 'image/png'
            }
        };

        const result = await geminiClient.model.generateContent([prompt, imagePart]);
        const text = result.response.text();

        // Parse JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Could not parse action plan');
        }

        const plan = JSON.parse(jsonMatch[0]);

        if (plan.needsMoreInfo) {
            return {
                type: 'response',
                message: plan.needsMoreInfo
            };
        }

        if (!plan.understood || !plan.actions || plan.actions.length === 0) {
            return {
                type: 'response',
                message: 'I had trouble understanding that request. Could you please rephrase?'
            };
        }

        // Execute actions
        let response = plan.explanation + '\n\n';

        for (const action of plan.actions) {
            const result = await executeAction(tab.id, action);
            response += result.message + '\n';
        }

        return {
            type: 'response',
            message: response.trim()
        };
    } catch (error) {
        console.error('Action error:', error);
        return {
            type: 'error',
            message: 'I had trouble performing that action. Please try again.'
        };
    }
}

/**
 * Execute a single action
 */
async function executeAction(tabId, action) {
    try {
        switch (action.type) {
            case 'navigate':
                let url = action.target;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                await chrome.tabs.update(tabId, { url });
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page load
                return { success: true, message: `Navigated to ${url}` };

            case 'click':
            case 'type':
            case 'scroll':
                // Send message to content script
                const result = await chrome.tabs.sendMessage(tabId, {
                    type: action.type,
                    target: action.target,
                    text: action.text
                });

                if (result.success) {
                    return { success: true, message: action.description };
                } else {
                    return { success: false, message: `Failed: ${result.error}` };
                }

            default:
                return { success: false, message: `Unknown action type: ${action.type}` };
        }
    } catch (error) {
        console.error('Execute action error:', error);
        return { success: false, message: error.message };
    }
}

console.log('Vision Agent background worker loaded');
