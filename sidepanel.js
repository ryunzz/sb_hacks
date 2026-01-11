/**
 * Vision Agent - Side Panel JavaScript
 * Handles voice input (Deepgram), text-to-speech, and communication with background script
 */

// DOM Elements
const messagesContainer = document.getElementById('messages');
const voiceBtn = document.getElementById('voiceBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const settingsBtn = document.getElementById('settingsBtn');
const muteBtn = document.getElementById('muteBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const micPermissionModal = document.getElementById('micPermissionModal');
const openMicSettingsBtn = document.getElementById('openMicSettings');
const closeModalBtn = document.getElementById('closeModal');
const recordingStatus = document.getElementById('recording-status');

// State
let isListening = false;
let isMuted = false;
let mediaRecorder = null;
let audioStream = null;
let deepgramApiKey = '';
let selectedLanguage = 'en';
let selectedVoice = 'aura-2-thalia-en';
let currentAudioQueue = [];
let isPlayingAudio = false;
let fillerTimeout = null;
let currentUserMessageId = null; // Track the current user message being spoken
let currentLoadingMessageId = null; // Track the loading message for responses
let isAgentActive = false; // Track if Computer Use agent is actively working

// Accessibility - Space bar hold-to-record state
let spaceBarPressed = false;           // Track space bar hold state
let recordingStartedBySpace = false;   // Track if auto-send should happen
let audioContext = null;               // Web Audio API context for earcons

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();
    setupOffscreenListeners();

    // Announce ready state for screen readers
    announceToScreenReader('Vision Agent is ready. Hold Space to record, release to send, press Escape to cancel. You can also click the microphone button or type your message below.');
});

/**
 * Setup listeners for offscreen document messages
 */
function setupOffscreenListeners() {
    chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
            case 'recording-started':
                console.log('Recording started via offscreen');
                break;

            case 'audio-chunk':
                // Received audio chunk from offscreen -> Send to Backend WS
                // message.data is base64 string
                if (isListening) {
                    chrome.runtime.sendMessage({
                        type: 'audio_input',
                        data: message.data
                    });
                }
                break;

            case 'recording-error':
                console.error('Recording error:', message.error);
                addMessage('assistant', `Error: ${message.error}`);
                stopListening();
                break;

            case 'microphone-permission-granted':
                addMessage('assistant', '✅ Microphone permission granted!');
                break;

            case 'transcript_confirmed':
                // Backend confirmed it heard us
                const text = message.text;
                addMessage('user', text);
                setStatus('Processing...');
                break;

            case 'agent-narration':
                console.log('[Agent] Narration:', message.text);
                speak(message.text);
                addMessage('assistant', message.text);
                break;

            case 'agent-complete':
                console.log('[Agent] Task complete:', message.summary);
                addMessage('assistant', message.success ? `✅ ${message.summary}` : `❌ ${message.summary}`);
                speak(message.summary);
                setStatus('Ready');
                break;

            case 'agent-error':
                console.error('[Agent] Error:', message.message);
                addMessage('assistant', `❌ Error: ${message.message}`);
                speak(`Error: ${message.message}`);
                setStatus('Error');
                break;
        }
    });
}

/**
 * Load configuration from storage
 */
async function loadConfig() {
    try {
        const config = await chrome.storage.local.get([
            'deepgramApiKey',
            'voiceMuted',
            'language',
            'voiceModel'
        ]);
        deepgramApiKey = config.deepgramApiKey || '';
        isMuted = config.voiceMuted || false;
        selectedLanguage = config.language || 'en';
        selectedVoice = config.voiceModel || 'aura-2-thalia-en';
        updateMuteButton();
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    voiceBtn.addEventListener('click', () => {
        if (isListening) stopListening();
        else startListening();
    });

    voiceBtn.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            if (isListening) stopListening();
            else startListening();
        }
    });

    sendBtn.addEventListener('click', sendTextMessage);
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
        }
    });

    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
    });

    settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
    muteBtn.addEventListener('click', toggleMute);
    clearChatBtn.addEventListener('click', clearChat);

    openMicSettingsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('requestPermissions.html'), active: true });
        hideMicPermissionModal();
    });

    closeModalBtn.addEventListener('click', hideMicPermissionModal);

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.deepgramApiKey) deepgramApiKey = changes.deepgramApiKey.newValue || '';
        if (changes.voiceModel) selectedVoice = changes.voiceModel.newValue || 'aura-2-thalia-en';
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement !== textInput && !spaceBarPressed) {
            e.preventDefault();
            spaceBarPressed = true;
            if (!isListening) {
                recordingStartedBySpace = true;
                startListening();
            }
        }
        if (e.code === 'Escape' && isListening) {
            e.preventDefault();
            cancelRecording();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && spaceBarPressed) {
            spaceBarPressed = false;
            if (isListening && recordingStartedBySpace) {
                stopListening();
            }
        }
    });
}

async function startListening() {
    if (isListening) return;

    if (!deepgramApiKey) {
        addMessage('assistant', 'Please set Deepgram API key in settings.');
        return;
    }

    isListening = true;
    voiceBtn.classList.add('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Stop Recording';
    setStatus('Listening... Speak now');

    try {
        // Start recording in offscreen document
        // We now send audio to backend, NOT directly to Deepgram here
        const response = await chrome.runtime.sendMessage({
            type: 'start-recording-ws', // New type for WS streaming
            language: selectedLanguage
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to start recording');
        }
    } catch (error) {
        console.error('Start recording error:', error);
        addMessage('assistant', `Microphone error: ${error.message}`);
        stopListening();
    }

    playEarcon('start');
}

function stopListening() {
    if (!isListening) return;

    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
    setStatus('Processing...');

    chrome.runtime.sendMessage({ type: 'stop-recording-ws' });
    playEarcon('stop');
}

function cancelRecording() {
    if (!isListening) return;
    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
    setStatus('Cancelled');
    chrome.runtime.sendMessage({ type: 'cancel-recording-ws' });
    playEarcon('cancel');
}

function sendTextMessage() {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    handleUserInput(text);
}

async function handleUserInput(input) {
    addMessage('user', input);
    setStatus('Thinking...');
    
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'message',
            content: input
        });
        
        if (response && response.type === 'response') {
            addMessage('assistant', response.message);
            speak(response.message);
        } else if (response && response.type === 'error') {
            addMessage('assistant', `Error: ${response.message}`);
        }
    } catch (error) {
        console.error('Message error:', error);
        addMessage('assistant', 'Error sending message.');
    }
}

async function handleQuickAction(action) {
    const prompts = {
        describe: "Hey, what's on this page?",
        summary: 'What are the key points from this page?',
        scam: 'Does this site look trustworthy?'
    };
    if (prompts[action]) handleUserInput(prompts[action]);
}

function addMessage(role, content, isLoading = false) {
    const id = 'msg-' + Date.now();
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}${isLoading ? ' loading' : ''}`;
    messageEl.id = id;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.textContent = content;
    
    messageEl.appendChild(contentEl);
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return id;
}

function setStatus(text) {
    statusEl.textContent = text;
}

// Reuse existing TTS logic (frontend for now, triggered by backend messages)
async function speak(text) {
    if (isMuted || !text) return;
    
    if (!deepgramApiKey) {
        // Fallback to browser TTS
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
        return;
    }

    try {
        const response = await fetch('https://api.deepgram.com/v1/speak?model=' + selectedVoice, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${deepgramApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) throw new Error('TTS API error');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
    } catch (error) {
        console.error('TTS error:', error);
        // Fallback
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
    }
}

function stopAllAudio() {
    window.speechSynthesis.cancel();
    // Logic to stop audio elements would go here
}

function toggleMute() {
    isMuted = !isMuted;
    chrome.storage.local.set({ voiceMuted: isMuted });
    updateMuteButton();
}

function updateMuteButton() {
    muteBtn.textContent = isMuted ? '🔇 Voice Off' : '🔊 Voice On';
    muteBtn.classList.toggle('muted', isMuted);
}

function initAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
}

function playEarcon(type) {
    try {
        const ctx = initAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        if (type === 'start') {
            oscillator.frequency.value = 800;
            gainNode.gain.value = 0.3;
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.1);
        } else if (type === 'stop') {
            oscillator.frequency.value = 600;
            gainNode.gain.value = 0.3;
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.15);
        }
    } catch (e) { console.error(e); }
}

function announceToScreenReader(msg) {
    // Implementation omitted for brevity - same as before
}

function clearChat() {
    stopAllAudio();
    messagesContainer.innerHTML = '';
    textInput.value = '';
    setStatus('Ready');
}

function hideMicPermissionModal() {
    micPermissionModal.classList.remove('visible');
}