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
    elevenlabsApiKey: ''
};

// Load config from storage
async function loadConfig() {
    const stored = await chrome.storage.local.get(['geminiApiKey', 'elevenlabsApiKey']);
    config.geminiApiKey = stored.geminiApiKey || '';
    config.elevenlabsApiKey = stored.elevenlabsApiKey || '';

    if (config.geminiApiKey) {
        initGemini();
    }

    console.log('Config loaded:', {
        hasGeminiKey: !!config.geminiApiKey,
        hasElevenLabsKey: !!config.elevenlabsApiKey,
        elevenlabsKeyLength: config.elevenlabsApiKey ? config.elevenlabsApiKey.length : 0
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
        if (changes.elevenlabsApiKey) {
            config.elevenlabsApiKey = changes.elevenlabsApiKey.newValue || '';
            console.log('ElevenLabs API key updated in config');
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
            handleUserMessage(message.content)
                .then((result) => {
                    console.log('handleUserMessage result:', result);
                    // Ensure result has proper structure
                    if (!result || typeof result !== 'object' || !result.type) {
                        console.error('Invalid response format from handleUserMessage:', result);
                        sendResponse({
                            type: 'error',
                            message: 'Sorry, I got an unexpected response. Could you try that again?'
                        });
                    } else {
                        console.log('Sending response to sidepanel:', { type: result.type, hasMessage: !!result.message });
                        sendResponse(result);
                    }
                })
                .catch((error) => {
                    console.error('Error in message handler:', error);
                    sendResponse({
                        type: 'error',
                        message: 'Sorry, I ran into an issue processing that. Mind trying again?'
                    });
                });
            return true; // Will respond asynchronously

        case 'describe':
            describeActiveTab()
                .then(sendResponse)
                .catch((error) => {
                    console.error('Error in describe handler:', error);
                    sendResponse({
                        type: 'error',
                        message: 'Sorry, I couldn\'t see your screen right now. Could you try again?'
                    });
                });
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
            // Note: No API key needed for Web Speech API (browser-native)
            setupOffscreenDocument().then(async () => {
                // Ensure offscreen is ready
                if (!offscreenReady) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                // Send message to offscreen document
                const messageToSend = {
                    type: 'start-recording',
                    language: message.language || 'en'
                };

                console.log('Background: Starting Web Speech API recording:', {
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
        case 'transcript-update':
        case 'offscreen-ready':
            // Forward these messages from offscreen/other pages to all extension pages
            // The sidepanel will pick them up via chrome.runtime.onMessage
            // These are broadcast messages, not direct responses
            sendResponse({ success: true, forwarded: true });
            return true;

        default:
            sendResponse({ 
                type: 'error',
                message: 'Sorry, I didn\'t understand that request. Could you try again?'
            });
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
        const lowerInput = userInput.toLowerCase().trim();
        const isAction =
            lowerInput.includes('go to') ||
            lowerInput.includes('click') ||
            lowerInput.includes('type') ||
            lowerInput.includes('scroll') ||
            lowerInput.includes('navigate') ||
            lowerInput.includes('open');

        // Check if this is a request to describe the page/screen
        const isDescribeRequest =
            lowerInput.includes('screen') ||
            lowerInput.includes('see') ||
            lowerInput.includes('page') ||
            lowerInput.includes('describe') ||
            lowerInput.includes('what') && (lowerInput.includes('on') || lowerInput.includes('show'));

        console.log('Message routing:', { isAction, isDescribeRequest, input: userInput.substring(0, 50) });

        if (isAction) {
            console.log('Routing to action handler');
            return await handleActionRequest(userInput);
        } else if (isDescribeRequest) {
            console.log('Routing to describe handler');
            return await describeActiveTab(userInput);
        } else {
            console.log('Routing to chat handler');
            return await chat(userInput);
        }
    } catch (error) {
        console.error('Error handling message:', error);
        return {
            type: 'error',
            message: 'Sorry, I ran into an issue there. Could you try that again?'
        };
    }
}

/**
 * Chat with Gemini
 */
async function chat(message) {
    if (!geminiClient) {
        return {
            type: 'error',
            message: 'Please configure your Gemini API key in the extension options.'
        };
    }

    const systemPrompt = `You're a helpful friend helping someone navigate the web. Talk to them like you're texting or chatting - natural, casual, and friendly.

Here's how you should talk:
- Use contractions: "I'm", "you're", "that's", "it's", "don't", "can't"
- Talk like a real person, not a robot or manual
- Be brief and to the point
- Use everyday words, not fancy or technical language
- Sound warm and friendly, like you actually care

Example of good responses:
- "Yeah, that looks like a scam site. I'd stay away from it."
- "This article is basically saying that the new policy affects small businesses the most. The main takeaway is there are some tax changes coming next year."
- "I don't see any hidden fees here, but let me check the fine print... nope, looks clean to me."

Everything you say gets read out loud, so write exactly how you'd say it in a normal conversation. No lists, no bullet points, no formatting - just natural talking.`;

    try {
        console.log('Starting chat with Gemini, message:', message.substring(0, 50) + '...');
        const chat = geminiClient.model.startChat({
            history: conversationHistory.slice(0, -1).map(h => ({
                role: h.role,
                parts: [{ text: h.content }]
            })),
            systemInstruction: systemPrompt
        });

        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        if (!responseText || typeof responseText !== 'string') {
            console.error('Chat returned invalid response:', responseText);
            return {
                type: 'error',
                message: 'Sorry, I got an unexpected response from the AI. Could you try that again?'
            };
        }

        conversationHistory.push({
            role: 'assistant',
            content: responseText
        });

        console.log('Chat response received:', responseText.substring(0, 100) + '...');

        const responseObj = {
            type: 'response',
            message: responseText
        };
        
        console.log('Chat returning response object:', { type: responseObj.type, messageLength: responseObj.message?.length });
        return responseObj;
    } catch (error) {
        console.error('Chat error:', error);
        return {
            type: 'error',
            message: `Oops, something went wrong: ${error.message || 'Unknown error'}. Could you try that again?`
        };
    }
}

/**
 * Capture and describe active tab
 */
async function describeActiveTab(question = null) {
    if (!geminiClient) {
        return {
            type: 'error',
            message: 'Please configure your Gemini API key in the extension options.'
        };
    }

    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            return {
                type: 'error',
                message: 'No active tab found. Please open a webpage first.'
            };
        }

        // Capture screenshot
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png'
        });

        if (!dataUrl) {
            return {
                type: 'error',
                message: "Hmm, I couldn't grab a screenshot of your screen right now. Could you try again?"
            };
        }

        // Convert data URL to base64
        const base64 = dataUrl.split(',')[1];

        if (!base64) {
            return {
                type: 'error',
                message: "I had trouble processing that screenshot. Mind trying again?"
            };
        }

        // Analyze with Gemini - conversational and detailed
        const prompt = question || `You're looking at a friend's computer screen and describing what you see. Talk naturally, like you're on the phone with them.

Look at the image carefully and describe:
- What website or app they're on
- What the main content is about
- What buttons, links, or interactive elements are visible
- Any important information or text you can read
- What they can do or click on

Write it like you're talking to them directly. Use contractions like "you're", "it's", "that's". Be specific about what you actually see - don't make things up. If you see text, mention what it says. If you see buttons, say what they're labeled.

Keep it conversational and natural - like you're describing it over the phone. No lists, no bullet points, no formatting. Just talk to them.`;

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType: 'image/png'
            }
        };

        console.log('Calling Gemini vision model to describe screen...');
        const result = await geminiClient.visionModel.generateContent([prompt, imagePart]);
        let description = result.response.text();

        // Clean up any markdown formatting that might have slipped through
        // Remove all asterisks first
        description = description.replace(/\*\*/g, '');
        description = description.replace(/\*/g, '');
        // Remove markdown headers (# Header)
        description = description.replace(/^#+\s+/gm, '');
        // Remove bullet points, dashes, and list markers at start of lines
        description = description.replace(/^[\*\-\•]\s+/gm, '');
        // Remove numbered lists
        description = description.replace(/^\d+\.\s+/gm, '');
        // Remove standalone labels with colons (like "Website:" or "Main Elements:")
        description = description.replace(/^([A-Z][^:]+):\s*$/gm, '');
        // Remove patterns like "Website:" or "Main Elements:" at start of lines
        description = description.replace(/^([A-Z][a-z\s]+):\s*/gm, '');
        // Remove multiple newlines and replace with single space for flow
        description = description.replace(/\n{2,}/g, ' ');
        // Remove any remaining colons used as labels and replace with period
        description = description.replace(/([A-Z][a-z\s]+):\s+/g, '$1. ');
        // Clean up extra spaces
        description = description.replace(/\s{2,}/g, ' ');

        console.log('Screen description received:', description.substring(0, 100) + '...');

        return {
            type: 'response',
            message: description.trim()
        };
    } catch (error) {
        console.error('Describe error:', error);
        return {
            type: 'error',
            message: `Sorry, I couldn't see your screen right now. ${error.message ? `Here's what happened: ${error.message}. ` : ''}Could you try again?`
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
        const prompt = `You're helping a friend navigate the web. They asked you to do something, and you can see their screen.

User's request: ${instruction}

Create a JSON action plan with this structure:
{
  "understood": true/false,
  "explanation": "Tell them what you're about to do, like you're talking to a friend. Use contractions and natural language. Example: 'Alright, I'll click on that search button for you' or 'Got it, I'm going to type that in the search box now.'",
  "actions": [
    {
      "type": "navigate" | "click" | "type" | "scroll",
      "target": "URL or selector or text",
      "description": "What this action does"
    }
  ],
  "needsMoreInfo": "If you're not sure what they want, ask them a friendly question in natural language. Otherwise, set this to null"
}

The "explanation" gets read out loud, so write it exactly how you'd say it to a friend. No formal language, no technical terms - just natural talking.

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
                message: "I'm not quite sure what you'd like me to do. Could you say that again, maybe in a different way?"
            };
        }

        // Execute actions
        let response = plan.explanation;

        for (const action of plan.actions) {
            const result = await executeAction(tab.id, action);
            if (result.message && result.message !== plan.explanation) {
                response += ' ' + result.message;
            }
        }

        return {
            type: 'response',
            message: response.trim()
        };
    } catch (error) {
        console.error('Action error:', error);
        return {
            type: 'error',
            message: "I had trouble doing that for you. Could you try again, or maybe rephrase what you'd like me to do?"
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
                return { success: true, message: `I've opened ${url} for you.` };

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
                    return { success: true, message: action.description || 'Done!' };
                } else {
                    return { success: false, message: `Sorry, I couldn't do that. ${result.error || 'Something went wrong.'}` };
                }

            default:
                return { success: false, message: `I'm not sure how to do that type of action.` };
        }
    } catch (error) {
        console.error('Execute action error:', error);
        return { success: false, message: `Sorry, I ran into an issue: ${error.message || 'Something went wrong.'}` };
    }
}

console.log('Vision Agent background worker loaded');
