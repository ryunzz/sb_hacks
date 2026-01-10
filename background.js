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

// Load config from storage
async function loadConfig() {
    const stored = await chrome.storage.local.get(['geminiApiKey', 'deepgramApiKey']);
    config.geminiApiKey = stored.geminiApiKey || '';
    config.deepgramApiKey = stored.deepgramApiKey || '';

    if (config.geminiApiKey) {
        initGemini();
    }
    
    console.log('Config loaded:', {
        hasGeminiKey: !!config.geminiApiKey,
        hasDeepgramKey: !!config.deepgramApiKey,
        deepgramKeyLength: config.deepgramApiKey ? config.deepgramApiKey.length : 0
    });
}

// Initialize on installation
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Vision Agent installed');
    await loadConfig();

    // Open side panel when extension icon is clicked
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
});

// Also load config on startup (in case extension was reloaded)
loadConfig();

// Listen for storage changes to keep config in sync
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        if (changes.geminiApiKey) {
            config.geminiApiKey = changes.geminiApiKey.newValue || '';
            if (config.geminiApiKey) {
                initGemini();
            }
        }
        if (changes.deepgramApiKey) {
            config.deepgramApiKey = changes.deepgramApiKey.newValue || '';
            console.log('Deepgram API key updated in config');
        }
    }
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

        case 'start-recording':
            // Create offscreen document and start recording
            setupOffscreenDocument().then(async () => {
                // Ensure offscreen is ready
                if (!offscreenReady) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
                // Always fetch the latest API key from storage (in case it was updated in settings)
                const stored = await chrome.storage.local.get(['deepgramApiKey']);
                const currentDeepgramApiKey = stored.deepgramApiKey || config.deepgramApiKey || '';
                
                // Update config for future use
                if (stored.deepgramApiKey) {
                    config.deepgramApiKey = stored.deepgramApiKey;
                }
                
                // Log API key status for debugging
                console.log('Background: Preparing to send API key to offscreen:', {
                    hasStoredKey: !!stored.deepgramApiKey,
                    hasConfigKey: !!config.deepgramApiKey,
                    currentKeyLength: currentDeepgramApiKey ? currentDeepgramApiKey.length : 0,
                    currentKeyPreview: currentDeepgramApiKey ? currentDeepgramApiKey.substring(0, 10) + '...' : 'none'
                });
                
                // Check if API key exists
                if (!currentDeepgramApiKey || currentDeepgramApiKey.trim() === '') {
                    console.error('Background: Deepgram API key is missing!');
                    sendResponse({ 
                        success: false, 
                        error: 'Deepgram API key is required. Please configure it in settings.' 
                    });
                    return;
                }
                
                // Send message to offscreen document
                // The offscreen document will send 'recording-started' or 'recording-error' messages
                // which the sidepanel already listens for
                const messageToSend = {
                    type: 'start-recording',
                    deepgramApiKey: currentDeepgramApiKey,
                    language: message.language || 'en'
                };
                
                console.log('Background: Sending message to offscreen:', {
                    type: messageToSend.type,
                    hasApiKey: !!messageToSend.deepgramApiKey,
                    apiKeyLength: messageToSend.deepgramApiKey ? messageToSend.deepgramApiKey.length : 0,
                    language: messageToSend.language
                });
                
                chrome.runtime.sendMessage(messageToSend).catch(error => {
                    console.error('Failed to send message to offscreen:', error);
                    sendResponse({ success: false, error: 'Failed to communicate with offscreen document' });
                });
                
                // Respond immediately - actual result will come via 'recording-started' or 'recording-error' messages
                sendResponse({ success: true });
            }).catch(error => {
                console.error('Failed to setup offscreen document:', error);
                sendResponse({ success: false, error: error.message });
            });
            return true;

        case 'stop-recording':
            // Forward to offscreen document
            chrome.runtime.sendMessage({ type: 'stop-recording' });
            sendResponse({ success: true });
            break;

        case 'transcript-result':
        case 'recording-started':
        case 'recording-error':
        case 'microphone-permission-granted':
            // Forward these messages from offscreen/other pages to all extension pages
            // The sidepanel will pick them up
            break;

        default:
            sendResponse({ error: 'Unknown message type' });
    }
});

/**
 * Create offscreen document for audio capture
 */
let creatingOffscreen = null;
let offscreenReady = false;

// Listen for offscreen ready signal
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'offscreen-ready') {
        offscreenReady = true;
        console.log('Offscreen document is ready');
    }
});

async function setupOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');

    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
        offscreenReady = true;
        return; // Already exists
    }

    // Create offscreen document (avoid race conditions)
    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        offscreenReady = false;
        creatingOffscreen = chrome.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['USER_MEDIA'],
            justification: 'Recording audio from microphone for voice input'
        });
        await creatingOffscreen;
        creatingOffscreen = null;
        
        // Wait for offscreen document to signal it's ready (with timeout)
        let attempts = 0;
        while (!offscreenReady && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!offscreenReady) {
            console.warn('Offscreen document did not signal ready, proceeding anyway');
            offscreenReady = true; // Proceed anyway
        }
    }
}

/**
 * Update configuration (API keys)
 */
async function updateConfig(newConfig) {
    config = { ...config, ...newConfig };
    await chrome.storage.local.set(config);

    if (config.geminiApiKey) {
        initGemini();
    }
    
    // Log API key update (without exposing the key)
    if (newConfig.deepgramApiKey !== undefined) {
        console.log('Deepgram API key updated:', newConfig.deepgramApiKey ? `Length: ${newConfig.deepgramApiKey.length}` : 'Removed');
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
