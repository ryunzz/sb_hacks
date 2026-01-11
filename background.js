/**
 * Vision Agent - Background Service Worker
 * Handles WebSocket connection to Python backend
 * Relays audio and messages between sidepanel/offscreen and backend
 */

let wsConnection = null;
const WS_URL = 'ws://localhost:8000';

// Connect on startup
connectToBackend();

/**
 * Connect to Python WebSocket backend
 */
function connectToBackend() {
    try {
        console.log('[Backend] Connecting to', WS_URL);
        wsConnection = new WebSocket(WS_URL);
        
        wsConnection.onopen = () => {
            console.log('[Backend] ✓ Connected to Python backend');
            
            // Send voice preference on connect
            chrome.storage.local.get(['voiceModel'], (config) => {
                const voice = config.voiceModel || 'aura-2-thalia-en';
                sendToBackend({ type: 'set_voice', voice: voice });
                console.log('[Backend] Sent voice preference:', voice);
            });
        };
        
        wsConnection.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleBackendMessage(data);
            } catch (e) {
                console.error('[Backend] Failed to parse message:', e);
            }
        };
        
        wsConnection.onclose = () => {
            console.log('[Backend] Disconnected, reconnecting in 2s...');
            wsConnection = null;
            setTimeout(connectToBackend, 2000);
        };
        
        wsConnection.onerror = (error) => {
            console.error('[Backend] WebSocket error:', error);
        };
        
    } catch (e) {
        console.error('[Backend] Connection failed:', e);
        setTimeout(connectToBackend, 5000);
    }
}

/**
 * Handle messages from Python backend
 */
function handleBackendMessage(data) {
    console.log('[Backend] Received:', data.type);
    
    // Map backend message types to sidepanel message types
    let sidepanelMessage = null;
    
    switch (data.type) {
        case 'transcript_confirmed':
            // Backend confirmed STT transcript
            sidepanelMessage = {
                type: 'transcript_confirmed',
                text: data.text
            };
            break;
            
        case 'transcript_result':
            // STT result (possibly empty)
            sidepanelMessage = {
                type: 'transcript_result',
                text: data.text || '',
                message: data.message
            };
            break;
            
        case 'narration':
            // Agent narration with optional TTS audio
            sidepanelMessage = {
                type: 'agent-narration',
                text: data.text,
                audio: data.audio || null,
                audio_format: data.audio_format || 'audio/mp3'
            };
            break;
            
        case 'task_complete':
            // Agent completed task with optional TTS audio
            sidepanelMessage = {
                type: 'agent-complete',
                success: data.success,
                summary: data.summary,
                audio: data.audio || null,
                audio_format: data.audio_format || 'audio/mp3'
            };
            break;
            
        case 'error':
            sidepanelMessage = {
                type: 'agent-error',
                message: data.message
            };
            break;
            
        case 'voice_updated':
            console.log('[Backend] Voice updated to:', data.voice);
            sidepanelMessage = data;
            break;
            
        case 'voices_list':
            console.log('[Backend] Available voices:', Object.keys(data.voices).length);
            sidepanelMessage = data;
            break;
            
        default:
            // Forward unknown types as-is
            sidepanelMessage = data;
    }
    
    // Send to sidepanel
    if (sidepanelMessage) {
        chrome.runtime.sendMessage(sidepanelMessage).catch(() => {
            // Sidepanel might not be open - that's OK
        });
    }
}

/**
 * Send message to Python backend
 */
function sendToBackend(message) {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify(message));
        return true;
    } else {
        console.error('[Backend] Not connected');
        chrome.runtime.sendMessage({
            type: 'agent-error',
            message: 'Not connected to backend. Please ensure the Python server is running.'
        }).catch(() => {});
        return false;
    }
}

/**
 * Listen for messages from sidepanel and offscreen
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Message:', message.type);
    
    switch (message.type) {
        // === Text commands ===
        case 'message':
            sendToBackend({ type: 'user_message', text: message.content });
            sendResponse({ type: 'response', message: 'Task sent to agent.' });
            return true;
            
        case 'interrupt':
            sendToBackend({ type: 'interrupt', new_instruction: message.new_instruction });
            sendResponse({ type: 'response', message: 'Interrupt sent.' });
            return true;
            
        // === Audio from offscreen (after recording stops) ===
        case 'audio-chunk':
            // Forward recorded audio to backend for STT
            console.log('[Background] Forwarding audio to backend for STT');
            sendToBackend({ type: 'audio_input', data: message.data });
            return true;
            
        // === Recording control ===
        case 'start-recording':
        case 'start-recording-ws':
            setupOffscreenDocument().then(() => {
                chrome.runtime.sendMessage({ type: 'offscreen-start-recording-ws' });
                sendResponse({ success: true });
            }).catch((error) => {
                console.error('[Background] Failed to setup offscreen:', error);
                sendResponse({ success: false, error: error.message });
            });
            return true;
            
        case 'stop-recording':
        case 'stop-recording-ws':
            chrome.runtime.sendMessage({ type: 'offscreen-stop-recording-ws' });
            sendResponse({ success: true });
            return true;
            
        case 'cancel-recording':
        case 'cancel-recording-ws':
            chrome.runtime.sendMessage({ type: 'offscreen-cancel-recording-ws' });
            sendResponse({ success: true });
            return true;
            
        // === Recording status from offscreen ===
        case 'recording-started':
            chrome.runtime.sendMessage({ type: 'recording-started' }).catch(() => {});
            return true;
            
        case 'recording-error':
            chrome.runtime.sendMessage({ 
                type: 'recording-error', 
                error: message.error 
            }).catch(() => {});
            return true;
            
        case 'recording-cancelled':
            chrome.runtime.sendMessage({ type: 'recording-cancelled' }).catch(() => {});
            return true;
            
        // === Voice settings ===
        case 'set-voice':
            sendToBackend({ type: 'set_voice', voice: message.voice });
            return true;
            
        case 'get-voices':
            sendToBackend({ type: 'get_voices' });
            return true;
            
        case 'config_updated':
            // Voice preference changed in settings
            if (message.config && message.config.voiceModel) {
                sendToBackend({ type: 'set_voice', voice: message.config.voiceModel });
            }
            return true;
            
        // === Other ===
        case 'clear-history':
            // Could send to backend if needed
            sendResponse({ success: true });
            return true;
    }
    
    return false;
});

/**
 * Listen for storage changes to update voice preference
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.voiceModel) {
        const newVoice = changes.voiceModel.newValue || 'aura-2-thalia-en';
        console.log('[Background] Voice changed to:', newVoice);
        sendToBackend({ type: 'set_voice', voice: newVoice });
    }
});

/**
 * Setup offscreen document for audio recording
 */
async function setupOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    
    // Check if already exists
    const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });
    
    if (existing.length === 0) {
        console.log('[Background] Creating offscreen document');
        await chrome.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['USER_MEDIA'],
            justification: 'Capture microphone audio for voice commands'
        });
    }
}
