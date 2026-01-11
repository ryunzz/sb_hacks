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
            model: genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }),
            visionModel: genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
        };
        console.log('Gemini initialized');
    } catch (error) {
        console.error('Failed to initialize Gemini:', error);
    }
}

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message.type, 'from:', sender.id || 'unknown');

    // Handle broadcast messages separately - these don't need responses
    if (['transcript-result', 'recording-started', 'recording-error', 'microphone-permission-granted', 'transcript-update', 'offscreen-ready'].includes(message.type)) {
        // These are one-way broadcasts from offscreen/other pages
        // The sidepanel listens for these via chrome.runtime.onMessage
        // Don't send a response for these
        return false;
    }

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
                .then((result) => {
                    console.log('describeActiveTab result:', result);
                    // Ensure result has proper structure
                    if (!result || typeof result !== 'object' || !result.type) {
                        console.error('Invalid response format from describeActiveTab:', result);
                        sendResponse({
                            type: 'error',
                            message: 'Sorry, I got an unexpected response. Could you try that again?'
                        });
                    } else {
                        console.log('Sending describe response to sidepanel:', { type: result.type, hasMessage: !!result.message });
                        sendResponse(result);
                    }
                })
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
            setupOffscreenDocument().then(async () => {
                // Ensure offscreen is ready with a small delay
                if (!offscreenReady) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                // Always fetch the latest API key from storage (fresh every time)
                let currentDeepgramApiKey = '';
                try {
                    const stored = await chrome.storage.local.get(['deepgramApiKey']);
                    currentDeepgramApiKey = stored.deepgramApiKey || '';

                    // Also update cached config
                    if (stored.deepgramApiKey) {
                        config.deepgramApiKey = stored.deepgramApiKey;
                    }

                    console.log('Background: Fresh API key fetch:', {
                        hasKey: !!currentDeepgramApiKey,
                        keyLength: currentDeepgramApiKey ? currentDeepgramApiKey.length : 0
                    });
                } catch (storageError) {
                    console.error('Background: Failed to fetch API key from storage:', storageError);
                    // Fall back to cached config
                    currentDeepgramApiKey = config.deepgramApiKey || '';
                }

                // Check if API key exists
                if (!currentDeepgramApiKey || currentDeepgramApiKey.trim() === '') {
                    console.error('Background: Deepgram API key is missing!');
                    const errorMsg = 'Deepgram API key is required. Please open extension settings (click the gear icon) and enter your Deepgram API key.';
                    sendResponse({
                        success: false,
                        error: errorMsg
                    });
                    chrome.runtime.sendMessage({
                        type: 'recording-error',
                        error: errorMsg
                    }).catch(() => { });
                    return;
                }

                // Send message to offscreen document with the API key
                const messageToSend = {
                    type: 'offscreen-start-recording',
                    deepgramApiKey: currentDeepgramApiKey.trim(),
                    language: message.language || 'en'
                };

                console.log('Background: Sending offscreen-start-recording with API key length:', messageToSend.deepgramApiKey.length);

                // Send to offscreen - this broadcasts but offscreen will pick it up
                chrome.runtime.sendMessage(messageToSend).catch(error => {
                    console.error('Failed to send message to offscreen:', error);
                });

                // Respond immediately
                sendResponse({ success: true });
            }).catch(error => {
                console.error('Failed to setup offscreen document:', error);
                sendResponse({ success: false, error: error.message });
            });
            return true;

        case 'stop-recording':
            // Forward to offscreen document with prefixed type
            chrome.runtime.sendMessage({ type: 'offscreen-stop-recording' }).catch(err => {
                console.error('Failed to send stop-recording to offscreen:', err);
            });
            sendResponse({ success: true });
            return true;

        case 'clear-history':
            // Clear conversation history
            conversationHistory = [];
            console.log('Conversation history cleared');
            sendResponse({ success: true });
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

        // Check if this is a request to describe the page/screen or answer questions about what's visible
        // This should be VERY broad - when in doubt, use vision!
        const isDescribeRequest =
            // Direct screen/page references
            lowerInput.includes('screen') ||
            lowerInput.includes('see') ||
            lowerInput.includes('page') ||
            lowerInput.includes('describe') ||

            // Specific content references
            lowerInput.includes('this repository') ||
            lowerInput.includes('this site') ||
            lowerInput.includes('this website') ||
            lowerInput.includes('this doc') ||
            lowerInput.includes('this document') ||
            lowerInput.includes('this tab') ||
            lowerInput.includes('this article') ||
            lowerInput.includes('this video') ||
            lowerInput.includes('this image') ||
            lowerInput.includes('this thread') ||
            lowerInput.includes('comment thread') ||
            lowerInput.includes('comments') ||

            // Question patterns
            lowerInput.includes('how many') ||
            lowerInput.includes('where is') ||
            lowerInput.includes('where can i') ||
            lowerInput.includes('can you see') ||
            lowerInput.includes('what does') ||
            lowerInput.includes('what is on') ||
            lowerInput.includes('what\'s on') ||
            lowerInput.includes('what is the title') ||
            lowerInput.includes('what\'s the title') ||

            // Analysis/insight requests
            lowerInput.includes('insights') ||
            lowerInput.includes('summarize') ||
            lowerInput.includes('summary') ||
            lowerInput.includes('analyze') ||
            lowerInput.includes('analysis') ||
            lowerInput.includes('explain') ||
            lowerInput.includes('tell me about') ||
            lowerInput.includes('what are') ||
            lowerInput.includes('give me') ||

            // Reading/viewing context
            lowerInput.includes('reading') ||
            lowerInput.includes('looking at') ||
            lowerInput.includes('watching') ||
            lowerInput.includes('viewing') ||

            // Broad "what" questions that likely need vision
            (lowerInput.includes('what') && (
                lowerInput.includes('on') ||
                lowerInput.includes('show') ||
                lowerInput.includes('here') ||
                lowerInput.includes('this') ||
                lowerInput.includes('from') ||
                lowerInput.includes('about')
            ));

        console.log('Message routing:', {
            isAction,
            isDescribeRequest,
            input: userInput.substring(0, 50),
            lowerInput: lowerInput.substring(0, 50),
            checks: {
                hasInsights: lowerInput.includes('insights'),
                hasComments: lowerInput.includes('comments'),
                hasThread: lowerInput.includes('thread'),
                hasSummarize: lowerInput.includes('summarize'),
                hasWhatFrom: lowerInput.includes('what') && lowerInput.includes('from')
            }
        });

        if (isAction) {
            console.log('Routing to action handler');
            return await handleActionRequest(userInput);
        } else if (isDescribeRequest) {
            console.log('Routing to describe handler (VISION MODEL)');
            return await describeActiveTab(userInput);
        } else {
            console.log('Routing to chat handler (NO VISION)');
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

    const systemPrompt = `You're a helpful friend helping someone who is blind navigate the web. Talk to them like you're chatting - natural, casual, and friendly. Make sure what you are saying is clear to someone who is blind

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

Everything you say gets read out loud, so write exactly how you'd say it in a normal conversation. No lists, no bullet points, no formatting - just natural talking.

In the end, send a friendly related follow up question or related statement (show personality).
`;

    try {
        console.log('Starting chat with Gemini, message:', message.substring(0, 50) + '...');
        const chat = geminiClient.model.startChat({
            history: conversationHistory.slice(0, -1).map(h => ({
                role: h.role === 'assistant' ? 'model' : h.role, // Gemini uses 'model' not 'assistant'
                parts: [{ text: h.content }]
            })),
            systemInstruction: systemPrompt
        });

        const result = await chat.sendMessage(message);
        let responseText = result.response.text();

        if (!responseText || typeof responseText !== 'string') {
            console.error('Chat returned invalid response:', responseText);
            return {
                type: 'error',
                message: 'Sorry, I got an unexpected response from the AI. Could you try that again?'
            };
        }

        // Clean up any markdown formatting or special symbols
        // Remove all asterisks
        responseText = responseText.replace(/\*\*/g, '');
        responseText = responseText.replace(/\*/g, '');
        // Remove markdown headers (# Header)
        responseText = responseText.replace(/^#+\s+/gm, '');
        // Remove bullet points, dashes, and list markers
        responseText = responseText.replace(/^[\*\-\•]\s+/gm, '');
        // Remove numbered lists
        responseText = responseText.replace(/^\d+\.\s+/gm, '');
        // Remove backticks used for code
        responseText = responseText.replace(/`/g, '');
        // Remove markdown links [text](url) - keep just the text
        responseText = responseText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        // Remove standalone labels with colons (like "Answer:" or "Result:")
        responseText = responseText.replace(/^([A-Z][^:]+):\s*$/gm, '');
        // Clean up extra spaces
        responseText = responseText.replace(/\s{2,}/g, ' ');

        conversationHistory.push({
            role: 'assistant',
            content: responseText
        });

        console.log('Chat response received:', responseText.substring(0, 100) + '...');

        const responseObj = {
            type: 'response',
            message: responseText.trim()
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
        const prompt = question || `You're looking at your blind friend's computer screen and describing what you see so they can understand what's on the screen. Talk naturally, like you're on the phone with them.

Look at the image carefully and describe:
- What website or app they're on
- What the main content is about
- What buttons, links, or interactive elements are visible
- Any important information or text you can read
- What they can do or click on

Write it like you're talking to them directly. Use contractions like "you're", "it's", "that's". Be specific about what you actually see - don't make things up. If you see text, mention what it says. If you see buttons, say what they're labeled.

Keep it conversational and natural - like you're describing it over the phone. No lists, no bullet points, no formatting. Just talk to them.

In the end, ask a related follow up question.
`;

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType: 'image/png'
            }
        };

        console.log('Calling Gemini vision model to describe screen...');
        const result = await geminiClient.visionModel.generateContent([prompt, imagePart]);
        let description = result.response.text();

        // Clean up any markdown formatting and special symbols
        // Remove all asterisks
        description = description.replace(/\*\*/g, '');
        description = description.replace(/\*/g, '');
        // Remove markdown headers (# Header)
        description = description.replace(/^#+\s+/gm, '');
        // Remove bullet points, dashes, and list markers at start of lines
        description = description.replace(/^[\*\-\•]\s+/gm, '');
        // Remove numbered lists
        description = description.replace(/^\d+\.\s+/gm, '');
        // Remove backticks used for code
        description = description.replace(/`/g, '');
        // Remove markdown links [text](url) - keep just the text
        description = description.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
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
        
        // Clean up the explanation and needsMoreInfo text to remove special symbols
        if (plan.explanation) {
            plan.explanation = plan.explanation.replace(/\*\*/g, '');
            plan.explanation = plan.explanation.replace(/\*/g, '');
            plan.explanation = plan.explanation.replace(/`/g, '');
            plan.explanation = plan.explanation.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        }
        if (plan.needsMoreInfo) {
            plan.needsMoreInfo = plan.needsMoreInfo.replace(/\*\*/g, '');
            plan.needsMoreInfo = plan.needsMoreInfo.replace(/\*/g, '');
            plan.needsMoreInfo = plan.needsMoreInfo.replace(/`/g, '');
            plan.needsMoreInfo = plan.needsMoreInfo.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
            
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
