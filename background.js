/**
 * Vision Agent - Background Service Worker
 * Handles WebSocket connection to Python backend and coordinates with offscreen/sidepanel
 * 
 * Architecture:
 * 1. Sidepanel sends commands (text/voice start) -> Background
 * 2. Background forwards to Backend via WebSocket
 * 3. Offscreen sends audio data -> Background -> Backend
 * 4. Backend sends updates (transcript, narration, action) -> Background -> Sidepanel
 */

let wsConnection = null;
const WS_URL = 'ws://localhost:8000';

// Connect immediately
connectToBackend();

function connectToBackend() {
    try {
        wsConnection = new WebSocket(WS_URL);
        
        wsConnection.onopen = () => {
            console.log('[Backend] Connected');
            chrome.runtime.sendMessage({ type: 'backend-status', status: 'connected' }).catch(() => {});
        };
        
        wsConnection.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleBackendMessage(data);
            } catch (e) {
                console.error('Failed to parse backend message:', e);
            }
        };
        
        wsConnection.onerror = (error) => {
            console.error('[Backend] WebSocket error:', error);
        };
        
        wsConnection.onclose = () => {
            console.log('[Backend] Disconnected, retrying in 2s...');
            chrome.runtime.sendMessage({ type: 'backend-status', status: 'disconnected' }).catch(() => {});
            setTimeout(connectToBackend, 2000);
        };
    } catch (e) {
        console.error('[Backend] Connection setup failed:', e);
        setTimeout(connectToBackend, 5000);
    }
}

function handleBackendMessage(data) {
    // Relay all messages from backend to sidepanel
    // The sidepanel will handle display and TTS
    chrome.runtime.sendMessage(data).catch(() => {
        // Ignore errors if sidepanel is closed
    });
}

function sendToBackend(message) {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify(message));
    } else {
        console.error('[Backend] Not connected, cannot send:', message.type);
        chrome.runtime.sendMessage({ 
            type: 'error', 
            message: 'Backend disconnected. Please start the Python server.' 
        }).catch(() => {});
    }
}

// Listen for messages from sidepanel and offscreen document
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'message':
            // Text command from user
            sendToBackend({ 
                type: 'user_message', 
                text: message.content 
            });
            sendResponse({ success: true });
            return true;

        case 'audio_input':
            // Audio chunk from offscreen recorder (base64)
            sendToBackend({ 
                type: 'audio_input', 
                data: message.data 
            });
            return true;

        case 'start-recording-ws':
            // Trigger recording in offscreen document
            setupOffscreenDocument().then(() => {
                // Wait briefly for document to be ready
                setTimeout(() => {
                    chrome.runtime.sendMessage({ type: 'offscreen-start-recording-ws' });
                }, 100);
                sendResponse({ success: true });
            }).catch(err => {
                console.error('Failed to setup offscreen:', err);
                sendResponse({ success: false, error: err.message });
            });
            return true;

        case 'stop-recording-ws':
            chrome.runtime.sendMessage({ type: 'offscreen-stop-recording-ws' });
            return true;

        case 'cancel-recording-ws':
            chrome.runtime.sendMessage({ type: 'offscreen-cancel-recording-ws' });
            return true;
            
        case 'recording-started':
        case 'recording-error':
            // Forward status to sidepanel
            return false; // allow broadcast
    }
});

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