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
const micPermissionModal = document.getElementById('micPermissionModal');
const openMicSettingsBtn = document.getElementById('openMicSettings');
const closeModalBtn = document.getElementById('closeModal');

// State
let isListening = false;
let isMuted = false;
let deepgramSocket = null;
let mediaRecorder = null;
let audioStream = null;
let deepgramApiKey = '';
let selectedLanguage = 'en';
let selectedVoice = 'aura-thalia-en';
let currentAudioQueue = [];
let isPlayingAudio = false;
let fillerTimeout = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();
    setupOffscreenListeners();

    // Announce ready state for screen readers
    announceToScreenReader('Vision Agent is ready. Press and hold the microphone button to speak, or type your message.');
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

            case 'transcript-result':
                console.log('Transcript received:', message.transcript);
                if (message.transcript) {
                    handleUserInput(message.transcript);
                }
                setStatus('Ready to help');
                break;

            case 'recording-error':
                console.error('Recording error:', message.error);
                const errorMsg = message.error || 'Voice recognition failed. Please try again.';
                // Replace newlines with line breaks for HTML display
                const formattedError = errorMsg.replace(/\n/g, '<br>');
                addMessage('assistant', formattedError, false, true);
                
                // If permission was denied, show request permission button
                if (message.showSettingsLink || (errorMsg && errorMsg.includes('permission'))) {
                    setTimeout(() => {
                        const lastMessage = messagesContainer.lastElementChild;
                        if (lastMessage) {
                            const requestBtn = document.createElement('button');
                            requestBtn.textContent = '🔧 Request Microphone Permission';
                            requestBtn.className = 'quick-btn';
                            requestBtn.style.marginTop = '12px';
                            requestBtn.style.width = '100%';
                            requestBtn.onclick = () => {
                                chrome.tabs.create({ 
                                    url: chrome.runtime.getURL('requestPermissions.html'),
                                    active: true
                                });
                            };
                            lastMessage.querySelector('.message-content').appendChild(requestBtn);
                        }
                    }, 100);
                }
                
                setStatus('Ready to help');
                break;
                
            case 'microphone-permission-granted':
                // Permission was granted in the requestPermissions page
                console.log('Microphone permission granted');
                addMessage('assistant', '✅ Microphone permission granted! You can now use voice input.');
                speak('Microphone permission granted. You can now use voice input.');
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
        selectedVoice = config.voiceModel || 'aura-thalia-en';
        updateMuteButton();
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Voice button - push to talk
    voiceBtn.addEventListener('mousedown', startListening);
    voiceBtn.addEventListener('mouseup', stopListening);
    voiceBtn.addEventListener('mouseleave', stopListening);
    voiceBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startListening();
    });
    voiceBtn.addEventListener('touchend', stopListening);

    // Keyboard support for voice button
    voiceBtn.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !isListening) {
            e.preventDefault();
            startListening();
        }
    });
    voiceBtn.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            stopListening();
        }
    });

    // Text input
    sendBtn.addEventListener('click', sendTextMessage);
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
        }
    });

    // Quick actions
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            handleQuickAction(action);
        });
    });

    // Settings
    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Mute toggle
    muteBtn.addEventListener('click', toggleMute);

    // Modal buttons
    openMicSettingsBtn.addEventListener('click', () => {
        // Open mic permission page in a new tab where Chrome allows proper permission requests
        // Based on: https://github.com/justinmann/sidepanel-audio-issue
        chrome.tabs.create({
            url: chrome.runtime.getURL('requestPermissions.html'),
            active: true
        });
        hideMicPermissionModal();
    });

    closeModalBtn.addEventListener('click', hideMicPermissionModal);

    // Listen for config updates
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.deepgramApiKey) {
            deepgramApiKey = changes.deepgramApiKey.newValue || '';
        }
        if (changes.language) {
            selectedLanguage = changes.language.newValue || 'en';
        }
        if (changes.voiceModel) {
            selectedVoice = changes.voiceModel.newValue || 'aura-thalia-en';
        }
    });
}

/**
 * Check if microphone permission is granted
 * Based on: https://github.com/justinmann/sidepanel-audio-issue
 */
async function checkMicrophonePermission() {
    try {
        // Try to query permission state (may not be available in all contexts)
        if (navigator.permissions && navigator.permissions.query) {
            const result = await navigator.permissions.query({ name: 'microphone' });
            return result.state === 'granted';
        }
        
        // If Permissions API not available, try a test getUserMedia call
        // This will fail silently if permission is denied
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (e) {
            return false;
        }
    } catch (error) {
        console.error('Error checking microphone permission:', error);
        return false;
    }
}

/**
 * Request microphone permission by opening requestPermissions page
 */
async function requestMicrophonePermission() {
    // Open the requestPermissions page in a new tab
    // This must be done in a regular tab, not the sidepanel
    chrome.tabs.create({
        url: chrome.runtime.getURL('requestPermissions.html'),
        active: true
    });
    
    addMessage('assistant', 'Opening microphone permission page. Please allow microphone access when prompted, then try again.');
    speak('Opening microphone permission page. Please allow microphone access when prompted.');
}

/**
 * Start listening via offscreen document
 */
async function startListening() {
    if (isListening) return;

    // Check for API key
    if (!deepgramApiKey) {
        addMessage('assistant', 'Please set up your Deepgram API key in settings to use voice input. You can still type messages below.');
        speak('Please set up your Deepgram API key in settings to use voice input.');
        return;
    }

    // Check microphone permission first
    // Based on: https://github.com/justinmann/sidepanel-audio-issue
    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
        addMessage('assistant', 'Microphone permission is required. Opening permission request page...');
        speak('Microphone permission is required. Opening permission request page.');
        await requestMicrophonePermission();
        return;
    }

    isListening = true;
    voiceBtn.classList.add('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Listening...';
    setStatus('Listening...');

    try {
        // Request recording via background script (which uses offscreen document)
        const response = await chrome.runtime.sendMessage({
            type: 'start-recording',
            language: selectedLanguage
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to start recording');
        }

    } catch (error) {
        console.error('Start recording error:', error);
        const errorMsg = error.message || 'Could not access microphone. Please check your permissions.';
        addMessage('assistant', errorMsg);
        
        // If permission error, offer to request permission again
        if (error.message && (error.message.includes('permission') || error.message.includes('NotAllowed'))) {
            setTimeout(() => {
                const retryBtn = document.createElement('button');
                retryBtn.textContent = '🔧 Request Microphone Permission';
                retryBtn.className = 'quick-btn';
                retryBtn.style.marginTop = '8px';
                retryBtn.onclick = () => requestMicrophonePermission();
                const lastMessage = messagesContainer.lastElementChild;
                if (lastMessage) {
                    lastMessage.querySelector('.message-content').appendChild(retryBtn);
                }
            }, 100);
        }
        
        stopListening();
    }
}

/**
 * Stop listening
 */
function stopListening() {
    if (!isListening) return;

    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Hold to Speak';
    setStatus('Processing...');

    // Tell background/offscreen to stop recording
    chrome.runtime.sendMessage({ type: 'stop-recording' });
}

/**
 * Send text message
 */
function sendTextMessage() {
    const text = textInput.value.trim();
    if (!text) return;

    textInput.value = '';
    handleUserInput(text);
}

/**
 * Handle user input (from voice or text)
 */
async function handleUserInput(input) {
    addMessage('user', input);
    setStatus('Thinking...');

    // Show loading state
    const loadingId = addMessage('assistant', '...', true);

    // Play conversational filler after 0.4 seconds for immediate responsiveness
    const fillerPhrases = [
        "Let me think about that for a moment...",
        "Hmm, interesting question. Give me a second...",
        "Let me analyze this for you...",
        "Just processing that...",
        "One moment while I look into this..."
    ];

    fillerTimeout = setTimeout(() => {
        const randomFiller = fillerPhrases[Math.floor(Math.random() * fillerPhrases.length)];
        speak(randomFiller);
    }, 400);

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'message',
            content: input
        });

        // Clear the filler timeout
        if (fillerTimeout) {
            clearTimeout(fillerTimeout);
            fillerTimeout = null;
        }

        // Stop any ongoing filler speech
        stopAllAudio();

        // Remove loading message
        removeMessage(loadingId);

        if (response.type === 'error') {
            addMessage('assistant', response.message);
            speak(response.message);
        } else {
            addMessage('assistant', response.message);
            speak(response.message);
        }

        setStatus('Ready to help');
    } catch (error) {
        console.error('Message error:', error);

        // Clear the filler timeout
        if (fillerTimeout) {
            clearTimeout(fillerTimeout);
            fillerTimeout = null;
        }

        stopAllAudio();
        removeMessage(loadingId);
        addMessage('assistant', 'Something went wrong. Please try again.');
        setStatus('Ready to help');
    }
}

/**
 * Handle quick actions
 */
async function handleQuickAction(action) {
    const prompts = {
        describe: 'Describe what\'s on my screen right now. What website is this and what are the main elements I can interact with?',
        summary: 'Give me a brief summary of the main content on this page. What are the key takeaways?',
        scam: 'Analyze this website for trustworthiness. Are there any red flags that suggest this might be a scam or untrustworthy site? Look for suspicious elements, hidden fees, or misleading information.'
    };

    const prompt = prompts[action];
    if (prompt) {
        handleUserInput(prompt);
    }
}

/**
 * Add message to chat
 */
function addMessage(role, content, isLoading = false, isHTML = false) {
    const id = 'msg-' + Date.now();
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}${isLoading ? ' loading' : ''}`;
    messageEl.id = id;

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    if (isHTML) {
        contentEl.innerHTML = content;
    } else {
        contentEl.textContent = content;
    }

    messageEl.appendChild(contentEl);
    messagesContainer.appendChild(messageEl);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return id;
}

/**
 * Remove message by ID
 */
function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

/**
 * Set status text
 */
function setStatus(text) {
    statusEl.textContent = text;
}

/**
 * Text-to-speech using Deepgram Aura (Thalia voice)
 */
async function speak(text) {
    if (isMuted || !text.trim()) return;

    // Stop any ongoing speech
    stopAllAudio();

    if (!deepgramApiKey) {
        console.warn('No Deepgram API key for TTS');
        return;
    }

    try {
        // Validate API key
        if (!deepgramApiKey || deepgramApiKey.trim() === '') {
            console.warn('No Deepgram API key for TTS');
            return;
        }

        const response = await fetch('https://api.deepgram.com/v1/speak?model=' + selectedVoice, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${deepgramApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('TTS API error:', response.status, errorText);
            
            let errorMessage = 'TTS request failed';
            if (response.status === 401) {
                errorMessage = 'Deepgram API key is invalid. Please check your settings.';
            } else if (response.status === 403) {
                errorMessage = 'Deepgram API key does not have TTS permissions.';
            } else if (response.status >= 500) {
                errorMessage = 'Deepgram service is temporarily unavailable. Please try again later.';
            }
            
            throw new Error(errorMessage);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        // Create and play audio
        const audio = new Audio(audioUrl);
        currentAudioQueue.push(audio);

        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
        };

        audio.onerror = (error) => {
            console.error('Audio playback error:', error);
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
        };

        isPlayingAudio = true;
        await audio.play();

    } catch (error) {
        console.error('TTS error:', error);
        // Don't show error to user for TTS failures - just log it
        // The text message will still be displayed
    }
}

/**
 * Stop all ongoing audio playback
 */
function stopAllAudio() {
    currentAudioQueue.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
    });
    currentAudioQueue = [];
    isPlayingAudio = false;
}

/**
 * Toggle mute
 */
function toggleMute() {
    isMuted = !isMuted;
    chrome.storage.local.set({ voiceMuted: isMuted });
    updateMuteButton();

    if (isMuted) {
        stopAllAudio();
        announceToScreenReader('Voice output muted');
    } else {
        announceToScreenReader('Voice output enabled');
    }
}

/**
 * Update mute button appearance
 */
function updateMuteButton() {
    if (isMuted) {
        muteBtn.textContent = '🔇 Voice Off';
        muteBtn.classList.add('muted');
    } else {
        muteBtn.textContent = '🔊 Voice On';
        muteBtn.classList.remove('muted');
    }
}

/**
 * Announce to screen readers
 */
function announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
}

/**
 * Show microphone permission modal
 */
function showMicPermissionModal() {
    micPermissionModal.classList.add('visible');
    announceToScreenReader('Microphone permission required. A dialog has opened with instructions.');
}

/**
 * Hide microphone permission modal
 */
function hideMicPermissionModal() {
    micPermissionModal.classList.remove('visible');
}
