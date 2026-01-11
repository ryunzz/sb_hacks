/**
 * Vision Agent - Background Service Worker
 * Replaces the Express server for Chrome Extension
 */

// WebSocket Backend Connection
let wsConnection = null;
const WS_URL = 'ws://localhost:8000';

// Connect to Python backend
connectToBackend();

// WebSocket Backend Connection Functions
async function connectToBackend() {
    try {
        wsConnection = new WebSocket(WS_URL);

        wsConnection.onopen = () => {
            console.log('[Backend] Connected to Python backend');
        };

        wsConnection.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleBackendMessage(data);
        };

        wsConnection.onerror = (error) => {
            console.error('[Backend] WebSocket error:', error);
        };

        wsConnection.onclose = () => {
            console.log('[Backend] Disconnected, reconnecting in 2s...');
            setTimeout(connectToBackend, 2000);
        };
    } catch (error) {
        console.error('[Backend] Connection failed:', error);
        setTimeout(connectToBackend, 5000);  // Retry after 5s
    }
}

function handleBackendMessage(data) {
    // Forward messages to sidepanel
    if (data.type === 'transcript_confirmed') {
        chrome.runtime.sendMessage({
            type: 'transcript_confirmed',
            text: data.text
        }).catch(() => {});
    } else if (data.type === 'narration') {
        chrome.runtime.sendMessage({
            type: 'agent-narration',
            text: data.text
        }).catch(() => {});
    } else if (data.type === 'task_complete') {
        chrome.runtime.sendMessage({
            type: 'agent-complete',
            success: data.success,
            summary: data.summary
        }).catch(() => {});
    } else if (data.type === 'error') {
        chrome.runtime.sendMessage({
            type: 'agent-error',
            message: data.message
        }).catch(() => {});
    }
}

function sendToBackend(message) {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify(message));
    } else {
        console.error('[Backend] Not connected to Python backend');
        chrome.runtime.sendMessage({
            type: 'agent-error',
            message: 'Python backend not connected. Please ensure the backend server is running.'
        }).catch(() => {});
    }
}

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'message':
            // Forward text message to backend
            sendToBackend({
                type: 'user_message',
                text: message.content
            });
            sendResponse({ type: 'response', message: 'Sent to agent' }); // Ack
            return true;

        case 'audio_input':
            // Forward audio chunk to backend
            sendToBackend({
                type: 'audio_input',
                data: message.data // base64
            });
            return true;

        case 'start-recording-ws':
            // Trigger offscreen recording
            setupOffscreenDocument().then(() => {
                chrome.runtime.sendMessage({ type: 'offscreen-start-recording-ws' });
                sendResponse({ success: true });
            });
            return true;

        case 'stop-recording-ws':
            chrome.runtime.sendMessage({ type: 'offscreen-stop-recording-ws' });
            return true;
            
        case 'cancel-recording-ws':
            chrome.runtime.sendMessage({ type: 'offscreen-cancel-recording-ws' });
            return true;
    }
});

// Offscreen management (simplified for brevity)
async function setupOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['USER_MEDIA'],
            justification: 'Recording audio for voice commands'
        });
    }
}