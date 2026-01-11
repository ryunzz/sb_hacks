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
let lastUserSpeechEndTime = 0;  // Track when user last stopped speaking for turn-taking
let isMuted = false;
let deepgramSocket = null;
let mediaRecorder = null;
let audioStream = null;
let deepgramApiKey = '';
let selectedLanguage = 'en';
let selectedVoice = 'aura-2-thalia-en';
let currentAudioQueue = [];
let isPlayingAudio = false;
let currentUserMessageId = null; // Track the current user message being spoken
let currentLoadingMessageId = null; // Track the loading message for responses
let isAgentActive = false; // Track if Computer Use agent is actively working

<<<<<<< HEAD
// TTS statistics for debugging
let ttsStats = {
    websocketSuccess: 0,
    websocketFailure: 0,
    browserTTSUsed: 0,
    lastReset: Date.now()
};

function logTTSStats() {
    const total = ttsStats.websocketSuccess + ttsStats.websocketFailure + ttsStats.browserTTSUsed;
    if (total > 0 && total % 10 === 0) {
        console.log('📊 TTS Stats:', {
            ...ttsStats,
            totalCalls: total,
            successRate: ((ttsStats.websocketSuccess / total) * 100).toFixed(1) + '%'
        });
    }
}
=======
// Accessibility - Space bar hold-to-record state
let spaceBarPressed = false;           // Track space bar hold state
let recordingStartedBySpace = false;   // Track if auto-send should happen
let audioContext = null;               // Web Audio API context for earcons
>>>>>>> feat/accessibility

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

            case 'transcript-update':
                // Real-time transcript updates - only update text input, not message area
                // User will review in text input and manually send
                console.log('Transcript update received:', message.transcript, 'isFinal:', message.isFinal);
                if (message.transcript && isListening) {
                    // Only update text input if we're currently recording
                    // CRITICAL: Always use the transcript from the message directly
                    // Don't append to existing value to prevent carryover
                    textInput.value = message.transcript;

                    // Show visual feedback that we're receiving audio
                    if (!message.isFinal) {
                        textInput.style.borderColor = '#4f9eff';
                        textInput.style.borderWidth = '2px';
                    } else {
                        textInput.style.borderColor = '#10b981';
                        textInput.style.borderWidth = '2px';
                    }
                }
                break;

            case 'transcript-result':
                // Final transcript when recording stops - put in input for user to review
                console.log('Final transcript received:', message.transcript);

                // Reset border styling
                textInput.style.borderColor = '';
                textInput.style.borderWidth = '';

                // Reset listening state
                isListening = false;
                voiceBtn.classList.remove('listening');
                voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
                voiceBtn.setAttribute('aria-label', 'Start recording');
                voiceBtn.setAttribute('title', 'Click to start recording');

                if (message.transcript && message.transcript.trim()) {
                    const finalText = message.transcript.trim();

                    // Put transcript in text input
                    textInput.value = finalText;

                    // Auto-send if recording was started by space bar
                    if (recordingStartedBySpace) {
                        recordingStartedBySpace = false;

                        // Small delay to ensure transcript is visible
                        setTimeout(() => {
                            if (textInput.value.trim()) {
                                sendTextMessage();
                                announceToScreenReader('Message sent');
                            }
                        }, 100);
                    } else {
                        // Existing manual review flow
                        // Focus the text input so user can edit or send
                        textInput.focus();

                        setStatus('Review and click Send');
                        announceToScreenReader('Transcript ready. Review and click send or press enter.');
                    }
                } else {
                    // No transcript, clear input
                    textInput.value = '';
                    recordingStartedBySpace = false;
                    setStatus('Ready to help');
                }
                break;

            case 'recording-error':
                console.error('Recording error:', message.error);
                const errorMsg = message.error || 'Voice recognition failed. Please try again.';
                // Replace newlines with line breaks for HTML display
                const formattedError = errorMsg.replace(/\n/g, '<br>');
                // Only show error once - check if we already have this error message
                const lastMessage = messagesContainer.lastElementChild;
                const lastMessageText = lastMessage?.querySelector('.message-content')?.textContent || '';
                if (!lastMessageText.includes('Deepgram API key') && !lastMessageText.includes('API key')) {
                    addMessage('assistant', formattedError, false, true);
                }
                // Reset listening state
                isListening = false;
                voiceBtn.classList.remove('listening');
                voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
                voiceBtn.setAttribute('aria-label', 'Start recording');
                voiceBtn.setAttribute('title', 'Click to start recording');
                setStatus('Ready to help');

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

            case 'agent-narration':
                // Agent is narrating its actions
                console.log('[Agent] Narration:', message.text, '(timing:', message.timing, ')');
                // Speak the narration via TTS
                speak(message.text);
                // Optionally show in UI based on timing
                if (message.timing === 'observation' || message.timing === 'completion') {
                    addMessage('assistant', message.text);
                }
                break;

            case 'agent-action':
                // Agent is performing an action
                console.log('[Agent] Action:', message.action, '-', message.description);
                // Show action in status or UI (optional - can be verbose)
                setStatus(message.description || 'Working...');
                break;

            case 'agent-complete':
                // Agent completed the task
                console.log('[Agent] Task complete:', message.success, '-', message.summary);
                const completionMsg = message.success
                    ? `✅ Task completed: ${message.summary}`
                    : `❌ Task failed: ${message.summary}`;
                addMessage('assistant', completionMsg);
                speak(message.summary);
                setStatus('Ready to help');
                break;

            case 'agent-error':
                // Agent encountered an error
                console.error('[Agent] Error:', message.message);
                addMessage('assistant', `❌ Error: ${message.message}`);
                speak(`Error: ${message.message}`);
                setStatus('Ready to help');
                break;

            case 'agent-state-update':
                // Agent state changed (active/inactive)
                console.log('[Agent] State update - isActive:', message.isActive);
                // Update global state
                isAgentActive = message.isActive;
                // Update UI state indicator if needed
                if (message.isActive) {
                    setStatus('Agent is working...');
                } else {
                    setStatus('Ready to help');
                }
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
    // Voice button - click to start/stop recording
    voiceBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        } else {
        startListening();
        }
    });

    // Keyboard support for voice button (Space or Enter to toggle)
    voiceBtn.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            if (isListening) {
                stopListening();
            } else {
            startListening();
        }
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

    // Clear chat button
    clearChatBtn.addEventListener('click', clearChat);

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
            selectedVoice = changes.voiceModel.newValue || 'aura-2-thalia-en';
        }
    });

    // Global keydown listener for space bar hold-to-record
    document.addEventListener('keydown', (e) => {
        // Only activate if:
        // 1. Space bar is pressed
        // 2. Text input is NOT focused (prevent typing conflict)
        // 3. Not already pressed (prevent key repeat triggering multiple starts)
        if (e.code === 'Space' &&
            document.activeElement !== textInput &&
            !spaceBarPressed) {

            e.preventDefault(); // Prevent page scroll
            spaceBarPressed = true;

            // Start recording
            if (!isListening) {
                recordingStartedBySpace = true;
                startListening();

                // Enhanced screen reader announcement
                announceToScreenReader('Recording started. Speak now. Release space to send, or press escape to cancel.');
            }
        }

        // Escape key to cancel recording
        if (e.code === 'Escape' && isListening) {
            e.preventDefault();
            cancelRecording();
        }
    });

    // Global keyup listener for auto-send on space release
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && spaceBarPressed) {
            spaceBarPressed = false;

            // Only stop if this recording was started by space bar
            if (isListening && recordingStartedBySpace) {
                // Stop recording - this will trigger auto-send
                stopListening();

                announceToScreenReader('Recording stopped. Processing and sending message.');
            }
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

    // TURN-TAKING: Stop all TTS audio when user starts speaking
    console.log('🎤 User starting to speak - stopping all TTS audio');
    stopAllAudio();
    currentAudioQueue = [];
    isPlayingAudio = false;

    // Try to load API key if not available
    if (!deepgramApiKey || deepgramApiKey.trim() === '') {
        try {
            const config = await chrome.storage.local.get(['deepgramApiKey']);
            deepgramApiKey = config.deepgramApiKey || '';
        } catch (error) {
            console.error('Failed to load Deepgram API key:', error);
        }
    }

    // Check for API key
    if (!deepgramApiKey || deepgramApiKey.trim() === '') {
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
    voiceBtn.querySelector('.voice-text').textContent = 'Stop Recording';
    voiceBtn.setAttribute('aria-label', 'Stop recording');
    voiceBtn.setAttribute('title', 'Click to stop recording');

    // Clear text input to prepare for new transcript
    textInput.value = '';
    textInput.style.borderColor = '';
    textInput.style.borderWidth = '';

    // Reset user message tracking for new recording session
    currentUserMessageId = null;

    setStatus('Listening... Speak now');

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

    // Play start earcon
    playEarcon('start');

    // Update ARIA live region for recording state
    if (recordingStatus) {
        recordingStatus.textContent = 'Recording in progress. Speak now.';
    }

    // Enhanced screen reader announcement (only if not already announced by space handler)
    if (!recordingStartedBySpace) {
        announceToScreenReader('Recording started. Speak now.');
    }
}

/**
 * Stop listening
 */
function stopListening() {
    if (!isListening) return;

    isListening = false;
    lastUserSpeechEndTime = Date.now();  // Track when user stopped speaking for turn-taking
    voiceBtn.classList.remove('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
    voiceBtn.setAttribute('aria-label', 'Start recording');
    voiceBtn.setAttribute('title', 'Click to start recording');
    setStatus('Processing...');

    // Tell background/offscreen to stop recording
    chrome.runtime.sendMessage({ type: 'stop-recording' });

    // Play stop earcon
    playEarcon('stop');

    // Update ARIA live region for recording state
    if (recordingStatus) {
        recordingStatus.textContent = 'Recording stopped. Processing your message.';
    }
}

/**
 * Cancel recording without sending
 */
function cancelRecording() {
    if (!isListening) {
        return; // Not recording, ignore
    }

    // Send cancel message to background script
    chrome.runtime.sendMessage({
        action: 'cancel-recording'
    });

    // Update UI state
    isListening = false;
    recordingStartedBySpace = false;
    voiceBtn.classList.remove('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
    voiceBtn.setAttribute('aria-label', 'Start recording');
    voiceBtn.setAttribute('title', 'Click to start recording');

    // Clear text input (discard any partial transcript)
    textInput.value = '';
    textInput.style.borderColor = '';
    textInput.style.borderWidth = '';

    // Update status
    setStatus('Recording cancelled');

    // Audio feedback
    playEarcon('cancel');

    // Update ARIA live region for recording state
    if (recordingStatus) {
        recordingStatus.textContent = 'Recording cancelled.';
    }

    // Screen reader announcement
    announceToScreenReader('Recording cancelled');
}

/**
 * Send text message
 */
function sendTextMessage() {
    const text = textInput.value.trim();
    if (!text) return;

    // Clear the input immediately to prevent it from being used again
    textInput.value = '';
    
    // Clear any transcript state to prevent carryover
    currentUserMessageId = null;
    
    handleUserInput(text);
}

/**
 * Handle user input (from voice or text)
 */
async function handleUserInput(input, existingUserMessageId = null) {
    // Clear text input immediately to prevent reuse
    textInput.value = '';
    
    // Only add a new user message if one wasn't already created (e.g., from voice transcript)
    if (!existingUserMessageId) {
        // This is a text input - add the user message
    addMessage('user', input);
    }
    // If existingUserMessageId is provided, the message already exists in the UI
    
    // Clear any transcript state to prevent carryover
    currentUserMessageId = null;

    setStatus('Thinking...');

    // Show loading state with animated dots
    currentLoadingMessageId = addMessage('assistant', '...', true);

    // FILLER SYSTEM DISABLED - No longer needed with fast WebSocket responses and turn-taking
    // Pre-load API key for TTS if not already loaded
    if (!deepgramApiKey || deepgramApiKey.trim() === '') {
        try {
            const config = await chrome.storage.local.get(['deepgramApiKey', 'voiceModel']);
            deepgramApiKey = config.deepgramApiKey || '';
            selectedVoice = config.voiceModel || 'aura-2-thalia-en';
            console.log('Pre-loaded TTS config, voice:', selectedVoice);
        } catch (error) {
            console.warn('Failed to pre-load TTS config:', error);
        }
    }

    try {
        console.log('Sending message to background:', input);

        // Check if agent is currently active - if so, this is an interruption
        const isInterruption = isAgentActive;

        if (isInterruption) {
            console.log('[Interruption] Agent is active - sending interruption to backend');
            // Send interruption directly to backend
            const response = await chrome.runtime.sendMessage({
                type: 'interrupt',
                new_instruction: input
            });
            // Update the loading message immediately
            if (currentLoadingMessageId) {
                const loadingEl = document.getElementById(currentLoadingMessageId);
                if (loadingEl) {
                    const contentEl = loadingEl.querySelector('.message-content');
                    if (contentEl) {
                        contentEl.textContent = 'Interrupting current task...';
                    }
                }
            }
            return; // Don't continue with normal flow
        }

        const response = await chrome.runtime.sendMessage({
            type: 'message',
            content: input
        });

        console.log('=== RESPONSE RECEIVED ===', new Date().toISOString());
        console.log('Response:', response?.type);

        // Update loading message with response instead of removing it (do this in parallel with audio prep)
        if (currentLoadingMessageId) {
            const loadingEl = document.getElementById(currentLoadingMessageId);
            if (loadingEl) {
                // Ensure it's an assistant message (not user)
                loadingEl.classList.remove('loading');
                if (!loadingEl.classList.contains('assistant')) {
                    loadingEl.classList.remove('user');
                    loadingEl.classList.add('assistant');
                }
                const contentEl = loadingEl.querySelector('.message-content');
                if (contentEl) {
                    // We'll update this with the actual response below
                }
            }
        }

        // Check if response is valid
        if (!response) {
            console.error('No response received from background');
            addMessage('assistant', 'No response received. Please check your API keys and try again.');
            speak('No response received. Please check your API keys and try again.');
            setStatus('Ready to help');
            return;
        }

        if (response.type === 'error') {
            console.error('Error response received:', response);
            console.error('Error message:', response.message);
            const errorText = response.message || 'An error occurred. Please try again.';
            // Update loading message with error
            if (currentLoadingMessageId) {
                const loadingEl = document.getElementById(currentLoadingMessageId);
                if (loadingEl) {
                    // Ensure it's an assistant message (left side, not user)
                    loadingEl.classList.remove('loading', 'user');
                    loadingEl.classList.add('assistant');
                    const contentEl = loadingEl.querySelector('.message-content');
                    if (contentEl) {
                        contentEl.textContent = errorText;
                    }
                }
        } else {
                addMessage('assistant', errorText);
            }
            if (response.message) {
                console.log('Speaking error message');
                try {
                    await speak(response.message, true);
                } catch (speakError) {
                    console.error('Error speaking (non-critical):', speakError);
                }
            }
        } else if (response.type === 'response') {
            const messageText = response.message || response.text || '';
            if (messageText && messageText.trim()) {
                console.log('Success response:', messageText.substring(0, 100));
                // Update loading message with actual response
                if (currentLoadingMessageId) {
                    const loadingEl = document.getElementById(currentLoadingMessageId);
                    if (loadingEl) {
                        // Ensure it's an assistant message (left side, not user)
                        loadingEl.classList.remove('loading', 'user');
                        loadingEl.classList.add('assistant');
                        const contentEl = loadingEl.querySelector('.message-content');
                        if (contentEl) {
                            contentEl.textContent = messageText;
                        }
                    }
                } else {
                    addMessage('assistant', messageText);
                }

                // Speak the response directly (no filler system)
                try {
                    console.log('=== SPEAKING RESPONSE NOW ===', new Date().toISOString());
                    console.log('Calling speak() with:', {
                        textLength: messageText.length,
                        stopExisting: true,
                        isMuted: isMuted
                    });

                    const speakStartTime = Date.now();
                    const speakResult = await speak(messageText, true);
                    const speakTime = Date.now() - speakStartTime;
                    console.log(`⏱️ Response speak() took ${speakTime}ms`);
                    console.log('=== RESPONSE SPEAK() COMPLETED ===', speakResult);
                    console.log('=== RESPONSE FINISHED ===', new Date().toISOString());
                } catch (speakError) {
                    console.error('❌ Speak error:', speakError);
                    console.error('Error stack:', speakError.stack);
                    // Try to speak error message
                    try {
                        await speak('Sorry, there was an error playing the response.', true);
                    } catch (e) {
                        console.error('Failed to speak error message:', e);
                    }
                }
            } else {
                console.error('Response type is "response" but no message field:', response);
                const errorText = 'Received response but no message content.';
                if (currentLoadingMessageId) {
                    const loadingEl = document.getElementById(currentLoadingMessageId);
                    if (loadingEl) {
                        const contentEl = loadingEl.querySelector('.message-content');
                        if (contentEl) {
                            contentEl.textContent = errorText;
                        }
                    }
                } else {
                    addMessage('assistant', errorText);
                }
            }
        } else {
            // Fallback: try to extract message from any response format
            console.log('Response format check - type:', response.type, 'keys:', Object.keys(response));

            // Check if it's an error object without type
            if (response.error) {
                console.error('Error response without type field:', response);
                const errorText = response.error || 'Something went wrong. Please try again.';
                if (currentLoadingMessageId) {
                    const loadingEl = document.getElementById(currentLoadingMessageId);
                    if (loadingEl) {
                        const contentEl = loadingEl.querySelector('.message-content');
                        if (contentEl) {
                            contentEl.textContent = errorText;
                        }
                    }
                } else {
                    addMessage('assistant', errorText);
                }
                console.log('Speaking error from fallback');
                try {
                    await speak(errorText, true);
                } catch (speakError) {
                    console.error('Error speaking (non-critical):', speakError);
                }
            } else if (response.forwarded) {
                // This is a forwarded message, ignore it
                console.log('Ignoring forwarded message');
                if (currentLoadingMessageId) {
                    removeMessage(currentLoadingMessageId);
                    currentLoadingMessageId = null;
                }
        setStatus('Ready to help');
            } else {
                const messageText = response.message || response.text || response.content || (typeof response === 'string' ? response : '');
                if (messageText && messageText.trim()) {
                    console.log('Response (fallback):', messageText.substring(0, 100));
                    if (currentLoadingMessageId) {
                        const loadingEl = document.getElementById(currentLoadingMessageId);
                        if (loadingEl) {
                            // Ensure it's an assistant message (left side, not user)
                            loadingEl.classList.remove('loading', 'user');
                            loadingEl.classList.add('assistant');
                            const contentEl = loadingEl.querySelector('.message-content');
                            if (contentEl) {
                                contentEl.textContent = messageText;
                            }
                        }
                    } else {
                        addMessage('assistant', messageText);
                    }
                    console.log('Speaking fallback message');
                    try {
                        await speak(messageText, true);
                    } catch (speakError) {
                        console.error('Error speaking (non-critical):', speakError);
                    }
                } else {
                    console.error('Could not extract message from response:', response);
                    const errorText = 'I received a response but couldn\'t understand the format. Please try again.';
                    if (currentLoadingMessageId) {
                        const loadingEl = document.getElementById(currentLoadingMessageId);
                        if (loadingEl) {
                            const contentEl = loadingEl.querySelector('.message-content');
                            if (contentEl) {
                                contentEl.textContent = errorText;
                            }
                        }
                    } else {
                        addMessage('assistant', errorText);
                    }
                    speak(errorText);
                }
            }
        }

        setStatus('Ready to help');
        // Reset loading message ID
        currentLoadingMessageId = null;
    } catch (error) {
        console.error('Message error:', error);

        stopAllAudio();

        // Update loading message with error
        if (currentLoadingMessageId) {
            const loadingEl = document.getElementById(currentLoadingMessageId);
            if (loadingEl) {
                const contentEl = loadingEl.querySelector('.message-content');
                if (contentEl) {
                    contentEl.textContent = `Something went wrong: ${error.message || 'Unknown error'}. Please try again.`;
                }
            }
        } else {
            removeMessage(currentLoadingMessageId);
            addMessage('assistant', `Something went wrong: ${error.message || 'Unknown error'}. Please try again.`);
        }
        speak('Something went wrong. Please try again.');
        setStatus('Ready to help');
        currentLoadingMessageId = null;
    }
}

/**
 * Handle quick actions
 */
async function handleQuickAction(action) {
    const prompts = {
        describe: "Hey, what's on this page?",
        summary: 'What are the key points from this page?',
        scam: 'Does this site look trustworthy or are there any red flags?'
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
/**
 * Split text into chunks that are under the character limit, trying to split on sentence boundaries
 */
function chunkText(text, maxLength = 1900) {
    // If text is already under limit, return as single chunk
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to find a good break point (sentence ending)
        let chunk = remaining.substring(0, maxLength);
        const lastPeriod = chunk.lastIndexOf('.');
        const lastExclamation = chunk.lastIndexOf('!');
        const lastQuestion = chunk.lastIndexOf('?');
        const lastNewline = chunk.lastIndexOf('\n');

        // Find the best break point (prefer sentence endings, then newlines)
        let breakPoint = Math.max(lastPeriod, lastExclamation, lastQuestion, lastNewline);

        // If we found a good break point (within last 200 chars), use it
        if (breakPoint > maxLength - 200 && breakPoint > 0) {
            chunk = remaining.substring(0, breakPoint + 1).trim();
            remaining = remaining.substring(breakPoint + 1).trim();
        } else {
            // No good break point, just split at maxLength
            chunk = remaining.substring(0, maxLength).trim();
            remaining = remaining.substring(maxLength).trim();
        }

        if (chunk.length > 0) {
            chunks.push(chunk);
        }
    }

    return chunks;
}

/**
 * Log TTS diagnostics for debugging
 */
function logTTSDiagnostics(stage, details) {
    console.log(`[TTS] ${stage}:`, {
        timestamp: new Date().toISOString(),
        stage,
        ...details
    });
}

/**
 * Speak text using Deepgram TTS, chunking if necessary
 */
async function speak(text, stopExisting = true) {
    console.log('🎙️ speak() called with:', {
        textLength: text ? text.length : 0,
        textPreview: text ? text.substring(0, 50) : 'null',
        stopExisting,
        isMuted,
        isListening,
        isPlayingAudio,
        hasApiKey: !!deepgramApiKey
    });

    logTTSDiagnostics('INIT', {
        textLength: text ? text.length : 0,
        textPreview: text ? text.substring(0, 50) : 'null',
        stopExisting: stopExisting,
        isMuted: isMuted,
        hasApiKey: !!deepgramApiKey,
        selectedVoice: selectedVoice
    });

    if (!text || typeof text !== 'string') {
        console.log('❌ speak() early return: invalid text');
        logTTSDiagnostics('SKIP', { reason: 'invalid_text' });
        return Promise.resolve();
    }

    if (isMuted) {
        logTTSDiagnostics('SKIP', { reason: 'muted' });
        return Promise.resolve();
    }

    if (!text.trim()) {
        logTTSDiagnostics('SKIP', { reason: 'empty_text' });
        return Promise.resolve();
    }

    // TURN-TAKING: Debug logging
    console.log('🔍 Turn-taking check:', {
        isListening,
        lastUserSpeechEndTime,
        timeSinceUserSpeech: Date.now() - lastUserSpeechEndTime,
        isPlayingAudio
    });

    // TURN-TAKING: Don't speak if user is currently speaking
    if (isListening) {
        console.log('🎤 User is speaking - skipping TTS to avoid overlap');
        logTTSDiagnostics('SKIP', { reason: 'user_is_speaking' });
        return Promise.resolve();
    }

    // TURN-TAKING: Add grace period after user stops speaking (300ms)
    // This prevents TTS from starting too quickly and feeling like an interruption
    const timeSinceUserSpeech = Date.now() - lastUserSpeechEndTime;
    const GRACE_PERIOD_MS = 300;
    if (lastUserSpeechEndTime > 0 && timeSinceUserSpeech < GRACE_PERIOD_MS) {
        const waitTime = GRACE_PERIOD_MS - timeSinceUserSpeech;
        console.log(`⏳ Waiting ${waitTime}ms grace period after user speech before TTS`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        console.log('✅ Grace period complete, proceeding with TTS');
    }

    // Stop any ongoing speech if requested
    if (stopExisting) {
        console.log('🛑 Stopping existing audio (stopExisting=true)');
        stopAllAudio();
        currentAudioQueue = [];
        isPlayingAudio = false;
    } else {
        console.log('▶️ Not stopping existing audio (stopExisting=false)');
    }

    // Try to load API key and voice model if not available
    if (!deepgramApiKey || deepgramApiKey.trim() === '' || !selectedVoice) {
        try {
            const config = await chrome.storage.local.get(['deepgramApiKey', 'voiceModel']);
            deepgramApiKey = config.deepgramApiKey || '';
            selectedVoice = config.voiceModel || 'aura-2-thalia-en';
            console.log('TTS: Loaded voice model from config:', selectedVoice);
        } catch (error) {
            console.warn('Failed to load Deepgram config for TTS:', error);
        }
    }

    if (!deepgramApiKey || deepgramApiKey.trim() === '') {
        console.warn('No Deepgram API key for TTS - skipping speech output');
        return Promise.resolve();
    }
    
    // Ensure we have a valid voice model - always use Thalia (aura-2-thalia-en)
    if (!selectedVoice || selectedVoice === 'aura-thalia-en' || !selectedVoice.includes('thalia')) {
        selectedVoice = 'aura-2-thalia-en';
        console.log('TTS: Using Thalia voice model:', selectedVoice);
    }

    const ttsStartTime = Date.now(); // Track total TTS time
    
    try {
        // Use WebSocket TTS for streaming audio with lower latency
        console.log(`🚀 Using WebSocket TTS for streaming audio (model: ${selectedVoice})`);
        return await speakWithWebSocket(text, selectedVoice);
        // Process in batches of 2 to maximize throughput while avoiding 429 errors
        const MAX_CONCURRENT = 2;
        const fetchPromises = chunks.map((chunk, index) => {
            const apiUrl = 'https://api.deepgram.com/v1/speak?model=' + selectedVoice;
            const chunkRequestStartTime = Date.now();
            const batchNumber = Math.floor(index / MAX_CONCURRENT);
            const delay = batchNumber * 100; // 100ms between batches to avoid rate limits
            
            console.log(`📡 TTS API Request ${index + 1}/${chunks.length} (batch ${batchNumber + 1}):`, {
                url: apiUrl,
                chunkLength: chunk.length,
                chunkPreview: chunk.substring(0, 50),
                timestamp: new Date().toISOString()
            });
            
            return new Promise((resolve) => {
                setTimeout(() => {
                    fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Token ${deepgramApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            text: chunk
                        })
                    }).then(resolve).catch(resolve);
                }, delay);
            })
            .then(async (response) => {
                const chunkRequestTime = Date.now() - chunkRequestStartTime;
                console.log(`📥 TTS API Response ${index + 1} (took ${chunkRequestTime}ms):`, {
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok,
                    headers: Object.fromEntries(response.headers.entries())
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`❌ TTS API error for chunk ${index + 1} (took ${chunkRequestTime}ms):`, {
                        status: response.status,
                        statusText: response.statusText,
                        errorText: errorText
                    });
                    
                    // For 400 errors (bad model name), fail silently
                    if (response.status === 400) {
                        console.warn(`⚠️ TTS model not available for chunk ${index + 1}, skipping`);
                        return null;
                    }
                    
                    // For 413 errors, we shouldn't hit this since we chunk at 1900, but handle it
                    if (response.status === 413) {
                        console.warn(`⚠️ TTS chunk ${index + 1} too large, skipping`);
                        return null;
                    }
                    
                    return null; // Skip this chunk on error
                }
                
                return response.blob().then(blob => {
                    if (!blob || blob.size === 0) {
                        console.error(`❌ TTS: Invalid audio blob for chunk ${index + 1}`);
                        return null;
                    }
                    console.log(`✅ TTS: Received audio blob for chunk ${index + 1} (API took ${chunkRequestTime}ms), size: ${blob.size} bytes`);
                    return { index, blob };
                });
            })
            .catch(error => {
                console.error(`TTS: Fetch error for chunk ${index + 1}:`, error);
                return null;
            });
        });
        
        // Wait for all fetches to complete
        const audioBlobs = await Promise.all(fetchPromises);
        const fetchTime = Date.now() - fetchStartTime;
        console.log(`⏱️ TTS: All chunks fetched in ${fetchTime}ms (average: ${chunks.length > 0 ? (fetchTime / chunks.length).toFixed(0) : 0}ms per chunk)`);
        
        const playbackStartTime = Date.now();
        
        // Filter out null results and sort by index to maintain order
        const validBlobs = audioBlobs
            .filter(item => item !== null)
            .sort((a, b) => a.index - b.index);
        
        if (validBlobs.length === 0) {
            console.error('❌ TTS: No valid audio blobs received - cannot play audio!');
            console.error('This means the Deepgram API call failed or returned no audio data.');
            console.log('➡️ Falling back to Web Speech Synthesis (browser TTS)');
            return speakWithWebSpeech(text);
        }
        
        console.log(`▶️ TTS: Playing ${validBlobs.length} audio chunk(s) sequentially`);
        
        // Play chunks sequentially (but they're already fetched, so no API wait time)
        for (let i = 0; i < validBlobs.length; i++) {
            const { index, blob } = validBlobs[i];
            const audioUrl = URL.createObjectURL(blob);
            console.log(`🔗 TTS: Created blob URL for chunk ${index + 1}:`, audioUrl.substring(0, 50) + '...');

            // Create and play audio
            const audio = new Audio(audioUrl);
            audio.volume = 1.0;
            currentAudioQueue.push(audio);
            console.log(`🎵 TTS: Created audio element for chunk ${index + 1}:`, {
                readyState: audio.readyState,
                queueLength: currentAudioQueue.length
            });

            // Wait for this chunk to finish before playing the next one
            await new Promise((resolve, reject) => {
                let resolved = false;
                
                const cleanup = () => {
                    if (!resolved) {
                        resolved = true;
                        URL.revokeObjectURL(audioUrl);
                        currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                        isPlayingAudio = currentAudioQueue.length > 0;
                    }
                };
                
                audio.onended = () => {
                    console.log(`✅ TTS: Chunk ${index + 1} finished playing`);
                    cleanup();
                    resolve();
                };

                audio.onerror = (error) => {
                    console.error(`❌ TTS: Audio playback error for chunk ${index + 1}:`, {
                        error: error,
                        errorCode: audio.error?.code,
                        errorMessage: audio.error?.message,
                        audioSrc: audio.src?.substring(0, 50)
                    });
                    cleanup();
                    // Don't reject - just resolve so we can continue
                    resolve();
                };

                // Set up play promise
                isPlayingAudio = true;
                console.log(`▶️ TTS: Attempting to play chunk ${index + 1}...`);
                
                const playPromise = audio.play();
                console.log(`🎬 TTS: play() called for chunk ${index + 1}, promise:`, playPromise);
                
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log(`TTS: Audio ${index + 1} play() started successfully, currentTime: ${audio.currentTime}, duration: ${audio.duration}`);
                            // Verify audio is actually playing
                            setTimeout(() => {
                                if (audio.paused) {
                                    console.error(`TTS: Audio ${index + 1} is paused after play() - attempting to play again`);
                                    audio.play().catch(err => {
                                        console.error(`TTS: Retry play() failed for chunk ${index + 1}:`, err);
                                    });
                                } else {
                                    console.log(`TTS: Audio ${index + 1} confirmed playing, currentTime: ${audio.currentTime}`);
                                }
                            }, 100);
                        })
                        .catch((playError) => {
                            console.error(`TTS: audio.play() failed for chunk ${index + 1}:`, playError);
                            // Try to get more info about the error
                            if (playError.name === 'NotAllowedError') {
                                console.error(`TTS: Autoplay blocked for chunk ${index + 1} - user interaction required`);
                            }
                            // Don't reject - just log and resolve so we can continue
                            cleanup();
                            resolve();
                        });
                } else {
                    console.warn(`⚠️ TTS: audio.play() returned undefined for chunk ${index + 1} - checking if playing...`);
                    // If play() doesn't return a promise, audio might have started immediately
                    // Wait a bit to see if it plays, then resolve
                    setTimeout(() => {
                        if (audio.paused) {
                            console.error(`❌ TTS: Audio ${index + 1} is still paused after play() call - attempting to play`);
                            audio.play().catch(err => {
                                console.error(`❌ TTS: Retry play() failed:`, err);
                                // Resolve anyway so we don't hang
                                if (!resolved) {
                                    cleanup();
                                    resolve();
                                }
                            });
                        } else {
                            console.log(`✅ TTS: Audio ${index + 1} is playing`);
                        }
                        // Resolve after checking (audio should be playing or we'll handle error above)
                        // But wait for onended to fire naturally
                    }, 100);
                }
            });
        }
        const playbackTime = Date.now() - playbackStartTime;
        const totalTtsTime = Date.now() - ttsStartTime;
        console.log(`✅ TTS: All chunks finished playing. Playback: ${playbackTime}ms, Total: ${totalTtsTime}ms`);
        console.log(`✅ TTS: speak() function completing successfully`);
        
        // Explicitly return resolved promise to ensure speak() resolves
        return Promise.resolve();

    } catch (error) {
        console.error('❌ TTS error:', error);
        console.error('Error stack:', error.stack);
        console.log('➡️ Falling back to Web Speech Synthesis (browser TTS)');
        // Fallback to browser TTS if Deepgram fails
        return speakWithWebSpeech(text);
    }
}

/**
 * Speak text using Deepgram WebSocket TTS API for streaming audio
 * This provides lower latency and allows playback to start immediately
 */
async function speakWithWebSocket(text, voiceModel) {
    const wsStartTime = Date.now();
    console.log(`🔌 WebSocket TTS: Starting connection for "${text.substring(0, 50)}..."`);

    return new Promise(async (resolve, reject) => {
        // Ensure we're using Thalia voice model (aura-2-thalia-en)
        // This is Deepgram's recommended voice for conversational TTS
        const model = voiceModel && voiceModel.includes('thalia') ? voiceModel : 'aura-2-thalia-en';
        if (model !== voiceModel) {
            console.log(`🔌 WebSocket TTS: Using Thalia voice model: ${model} (was: ${voiceModel})`);
        }
        
        // Split text into chunks if too long (WebSocket can handle longer, but chunk for reliability)
        const chunks = chunkText(text.trim(), 1900);
        console.log(`🔌 WebSocket TTS: Processing ${chunks.length} chunk(s)`);

        // Pre-initialize AudioContext BEFORE WebSocket to catch failures early
        let audioContext = null;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log(`🎵 WebSocket TTS: AudioContext initialized (state: ${audioContext.state})`);

            // Resume if suspended (required by some browsers)
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log(`🎵 WebSocket TTS: AudioContext resumed`);
            }
        } catch (error) {
            console.error('❌ WebSocket TTS: Failed to create AudioContext:', error);
            console.log('➡️ WebSocket TTS: Falling back to browser TTS immediately');
            return speakWithWebSpeech(text);
        }

        // WebSocket URL for TTS - using Thalia voice model
        // encoding=linear16: Raw 16-bit PCM audio (default)
        // sample_rate=24000: 24kHz sample rate (default)
        const wsUrl = `wss://api.deepgram.com/v1/speak?model=${model}&encoding=linear16&sample_rate=24000`;
        console.log(`🔌 WebSocket TTS: Connecting to ${wsUrl}`);

        // Create WebSocket connection with API key as subprotocol
        const ws = new WebSocket(wsUrl, ['token', deepgramApiKey.trim()]);

        // Detailed connection logging for debugging
        console.log(`🔌 WebSocket TTS: API key length: ${deepgramApiKey.trim().length}`);
        console.log(`🔌 WebSocket TTS: Model: ${model}`);
        console.log(`🔌 WebSocket TTS: Text chunks: ${chunks.length}`);

        let audioChunks = [];
        let sourceNodes = [];
        let isPlaying = false;
        let chunksProcessed = 0;
        let connectionStartTime = Date.now();
        let firstAudioReceived = false;
        let firstAudioTime = null;
        let totalAudioDuration = 0;
        let nextPlayTime = 0;
        
        // Connection timeout - increased to 20s for slower networks
        const connectionTimeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                console.error('❌ WebSocket TTS: Connection timeout (20s)');
                ws.close();
                reject(new Error('WebSocket connection timeout'));
            }
        }, 20000);
        
        ws.onopen = () => {
            const connectionTime = Date.now() - connectionStartTime;
            console.log(`✅ WebSocket TTS: Connected in ${connectionTime}ms`);
            clearTimeout(connectionTimeout);

            // AudioContext already initialized before WebSocket connection

            // Send text chunks in proper JSON format
            chunks.forEach((chunk, index) => {
                console.log(`📤 WebSocket TTS: Sending chunk ${index + 1}/${chunks.length} (${chunk.length} chars)`);
                ws.send(JSON.stringify({ type: 'Speak', text: chunk }));
            });

            // Send Flush command to get audio back
            setTimeout(() => {
                console.log(`📤 WebSocket TTS: Sending Flush command`);
                ws.send(JSON.stringify({ type: 'Flush' }));
            }, 100);
        };
        
        ws.onmessage = async (event) => {
            try {
                // Check if message is binary (audio data) or text (metadata)
                if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
                    // Binary audio data - decode and play immediately
                    if (!firstAudioReceived) {
                        firstAudioReceived = true;
                        firstAudioTime = Date.now() - wsStartTime;
                        console.log(`🎵 WebSocket TTS: First audio chunk received in ${firstAudioTime}ms (streaming started!)`);
                    }
                    
                    const arrayBuffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
                    audioChunks.push(arrayBuffer);

                    // Process raw PCM data from Deepgram (linear16 format)
                    let pcmData;
                    try {
                        // Deepgram sends raw 16-bit PCM data, not containerized audio
                        // We need to manually create an AudioBuffer from the raw PCM
                        pcmData = new Int16Array(arrayBuffer);

                        // Create AudioBuffer with Deepgram's format:
                        // - 1 channel (mono)
                        // - sample rate: 24000 Hz (Deepgram default for linear16)
                        const audioBuffer = audioContext.createBuffer(
                            1,  // mono
                            pcmData.length,
                            24000  // sample rate
                        );

                        // Convert Int16 PCM to Float32 (Web Audio API format)
                        // Int16 range: -32768 to 32767 → Float32 range: -1.0 to 1.0
                        const channelData = audioBuffer.getChannelData(0);
                        for (let i = 0; i < pcmData.length; i++) {
                            channelData[i] = pcmData[i] / 32768.0;
                        }

                        totalAudioDuration += audioBuffer.duration;

                        // TURN-TAKING: Skip playback if user started speaking
                        if (isListening) {
                            console.log('🎤 User started speaking - skipping audio chunk playback');
                            return;  // Don't play this chunk
                        }

                        if (!isPlaying) {
                            isPlaying = true;
                            isPlayingAudio = true;
                            nextPlayTime = audioContext.currentTime;
                            console.log(`▶️ WebSocket TTS: Starting audio playback (streaming)`);
                        }

                        // Schedule playback at the right time (queue chunks sequentially)
                        const source = audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioContext.destination);
                        sourceNodes.push(source);
                        
                        // Calculate when to start this chunk (queue after previous chunks)
                        const startTime = nextPlayTime;
                        source.start(startTime);
                        nextPlayTime += audioBuffer.duration; // Queue next chunk after this one
                        
                        chunksProcessed++;
                        console.log(`🎵 WebSocket TTS: Playing audio chunk ${chunksProcessed} (${audioBuffer.duration.toFixed(2)}s, total: ${totalAudioDuration.toFixed(2)}s)`);
                        
                        // Track when this chunk finishes
                        source.onended = () => {
                            sourceNodes = sourceNodes.filter(n => n !== source);
                            if (sourceNodes.length === 0 && ws.readyState === WebSocket.CLOSED) {
                                isPlayingAudio = false;
                                console.log(`✅ WebSocket TTS: All audio playback completed`);
                            }
                        };
                    } catch (pcmError) {
                        console.error('❌ WebSocket TTS: Failed to process PCM audio:', pcmError);
                        console.error('   ArrayBuffer size:', arrayBuffer.byteLength);
                        console.error('   PCM samples:', pcmData?.length || 'N/A');
                    }
                } else {
                    // Text message (metadata)
                    try {
                        const data = JSON.parse(event.data);
                        console.log(`📥 WebSocket TTS: Received metadata:`, data);
                    } catch (parseError) {
                        console.log(`📥 WebSocket TTS: Received text message:`, event.data);
                    }
                }
            } catch (error) {
                console.error('❌ WebSocket TTS: Error processing message:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket TTS: WebSocket error event:', error);
            console.error('❌ WebSocket TTS: ReadyState:', ws.readyState);
            console.error('❌ WebSocket TTS: Has AudioContext:', !!audioContext);
            console.error('❌ WebSocket TTS: AudioContext state:', audioContext?.state);

            clearTimeout(connectionTimeout);

            // Close AudioContext if exists
            if (audioContext && audioContext.state !== 'closed') {
                audioContext.close();
            }

            reject(new Error('WebSocket TTS connection failed'));
        };
        
        ws.onclose = (event) => {
            const totalTime = Date.now() - wsStartTime;
            console.log(`🔌 WebSocket TTS: Closed (code=${event.code}, reason='${event.reason}', time=${totalTime}ms)`);
            if (firstAudioTime) {
                console.log(`⏱️ WebSocket TTS: Time to first audio: ${firstAudioTime}ms`);
            }

            clearTimeout(connectionTimeout);

            // Error codes that should trigger fallback to browser TTS
            const shouldFallback = [1006, 1008, 1002, 1003].includes(event.code);

            // Wait for audio to finish playing if we have audio
            if (isPlaying && totalAudioDuration > 0) {
                // Wait for all audio to finish (add small buffer)
                const waitTime = (totalAudioDuration * 1000) + 500;
                console.log(`⏳ WebSocket TTS: Waiting ${waitTime}ms for audio to finish...`);
                setTimeout(() => {
                    isPlayingAudio = false;
                    console.log(`✅ WebSocket TTS: Audio playback completed`);
                    ttsStats.websocketSuccess++;
                    logTTSStats();
                    resolve();
                }, waitTime);
            } else if (event.code === 1000 || event.code === 1001) {
                // Normal closure (task completed successfully)
                isPlayingAudio = false;
                ttsStats.websocketSuccess++;
                logTTSStats();
                resolve();
            } else if (shouldFallback) {
                // Error closure - fallback to Web Speech
                isPlayingAudio = false;
                console.log(`➡️ WebSocket TTS failed (code ${event.code}), falling back to Web Speech`);
                ttsStats.websocketFailure++;
                logTTSStats();
                speakWithWebSpeech(text).then(resolve).catch(resolve);
            } else {
                // Unknown closure code - resolve anyway to not hang
                isPlayingAudio = false;
                console.log(`⚠️ WebSocket TTS: Unknown close code ${event.code}, resolving`);
                ttsStats.websocketSuccess++;
                logTTSStats();
                resolve();
            }
        };
    });
}

/**
 * Browser TTS fallback using SpeechSynthesis
 * Ensures audio still plays if Deepgram TTS fails or returns empty audio
 */
async function speakWithWebSpeech(text) {
    // Track that we're using browser TTS fallback
    ttsStats.browserTTSUsed++;
    logTTSStats();

    // Guard: if API not available, just resolve
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        console.warn('Web Speech Synthesis not available - cannot fallback');
        return Promise.resolve();
    }

    return new Promise(resolve => {
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            utterance.onend = () => {
                console.log('✅ Web Speech Synthesis finished');
                resolve();
            };

            utterance.onerror = (err) => {
                console.error('❌ Web Speech Synthesis error:', err);
                resolve(); // Resolve to avoid blocking the flow
            };

            console.log('▶️ Web Speech Synthesis speaking...');
            window.speechSynthesis.speak(utterance);
        } catch (err) {
            console.error('❌ Web Speech Synthesis failed to start:', err);
            resolve();
        }
    });
}

/**
 * Helper function to speak a single chunk (used for recursive splitting)
 */
async function speakChunk(chunk) {
    if (!deepgramApiKey || !chunk.trim()) return;

    try {
        const response = await fetch('https://api.deepgram.com/v1/speak?model=' + selectedVoice, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${deepgramApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: chunk
            })
        });

        if (!response.ok) {
            console.error('TTS API error for chunk:', response.status);
            return;
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        currentAudioQueue.push(audio);

        await new Promise((resolve, reject) => {
        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
                resolve();
        };

        audio.onerror = (error) => {
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
                reject(error);
        };

        isPlayingAudio = true;
            audio.play().catch(reject);
        });
    } catch (error) {
        console.error('TTS chunk error:', error);
    }
}

/**
 * Stop all ongoing audio playback
 */
function stopAllAudio() {
    console.log(`stopAllAudio: Stopping ${currentAudioQueue.length} audio(s)`);
    currentAudioQueue.forEach(audio => {
        try {
        audio.pause();
        audio.currentTime = 0;
        } catch (e) {
            console.warn('Error stopping audio:', e);
        }
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
 * Initialize Web Audio API context for earcons (audio feedback beeps)
 */
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

/**
 * Play earcon (audio feedback beep) for different recording states
 * @param {string} type - Type of beep: 'start', 'stop', or 'cancel'
 */
function playEarcon(type) {
    try {
        const ctx = initAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        // Configure beep based on type
        switch(type) {
            case 'start':
                oscillator.frequency.value = 800; // Higher pitch for start
                gainNode.gain.value = 0.3;
                oscillator.start();
                oscillator.stop(ctx.currentTime + 0.1); // Short beep
                break;
            case 'stop':
                oscillator.frequency.value = 600; // Lower pitch for stop
                gainNode.gain.value = 0.3;
                oscillator.start();
                oscillator.stop(ctx.currentTime + 0.15); // Slightly longer
                break;
            case 'cancel':
                oscillator.frequency.value = 400; // Lower pitch for error/cancel
                gainNode.gain.value = 0.3;
                oscillator.start();
                oscillator.stop(ctx.currentTime + 0.2); // Longer for emphasis
                break;
        }
    } catch (error) {
        console.error('Error playing earcon:', error);
        // Fail silently - earcons are nice-to-have, not critical
    }
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

/**
 * Clear current input (not the whole chat)
 */
function clearChat() {
    // Stop any ongoing audio
    stopAllAudio();

    // Stop recording if active
    if (isListening) {
        stopListening();
    }

    // Clear all messages except the welcome message
    messagesContainer.innerHTML = `
        <div class="message assistant">
            <div class="message-content">
                Hello! I'm Vision Agent, your AI assistant for navigating the web.
                <strong>Keyboard users:</strong> Hold Space to record, release to send. Press Escape to cancel.
                You can also click the microphone button to start recording, or type your message below.
                Try saying "describe this page" to get started!
            </div>
        </div>
    `;

    // Clear text input
    textInput.value = '';

    // Reset state
    currentUserMessageId = null;
    currentLoadingMessageId = null;

    // Clear conversation history in background
    chrome.runtime.sendMessage({ type: 'clear-history' }).catch(err => {
        console.error('Failed to clear history in background:', err);
    });

    // Announce to screen reader
    announceToScreenReader('Chat history cleared');
    setStatus('Chat cleared - Ready to help');
}
