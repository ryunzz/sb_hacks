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
let deepgramSocket = null;
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

            case 'transcript_confirmed':
                // Backend confirmed STT transcript - show user message and start agent
                console.log('[Backend] Transcript confirmed:', message.text);
                if (message.text && message.text.trim()) {
                    // Reset listening state
                    isListening = false;
                    voiceBtn.classList.remove('listening');
                    voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
                    
                    // Show user message
                    addMessage('user', message.text);
                    setStatus('Agent is working...');
                    isAgentActive = true;
                }
                break;

            case 'agent-narration':
                // Agent is narrating its actions with optional TTS audio from backend
                console.log('[Agent] Narration:', message.text, '(has audio:', !!message.audio, ')');
                // Show message in UI
                addMessage('assistant', message.text);
                // Play backend TTS audio if available, otherwise use frontend TTS
                if (message.audio) {
                    playAudioFromBase64(message.audio, message.audio_format || 'audio/mp3');
                } else {
                    speak(message.text);
                }
                break;

            case 'agent-action':
                // Agent is performing an action
                console.log('[Agent] Action:', message.action, '-', message.description);
                // Show action in status or UI (optional - can be verbose)
                setStatus(message.description || 'Working...');
                break;

            case 'agent-complete':
                // Agent completed the task with optional TTS audio from backend
                console.log('[Agent] Task complete:', message.success, '-', message.summary, '(has audio:', !!message.audio, ')');
                isAgentActive = false;
                const completionMsg = message.success
                    ? `✅ Task completed: ${message.summary}`
                    : `❌ Task failed: ${message.summary}`;
                addMessage('assistant', completionMsg);
                // Play backend TTS audio if available, otherwise use frontend TTS
                if (message.audio) {
                    playAudioFromBase64(message.audio, message.audio_format || 'audio/mp3');
                } else {
                    speak(message.summary);
                }
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

    // Play conversational filler that repeats the question
    const lowerInput = input.toLowerCase();
    const isVisionRequest = lowerInput.includes('screen') || 
                           lowerInput.includes('see') || 
                           lowerInput.includes('look') ||
                           lowerInput.includes('what') || 
                           lowerInput.includes('describe') || 
                           lowerInput.includes('show') ||
                           lowerInput.includes('page') ||
                           lowerInput.includes('website') ||
                           lowerInput.includes('read') ||
                           lowerInput.includes('tell me about');
    
    let fillerMessage = '';
    
    if (isVisionRequest) {
        // For vision requests - repeat question + explain we're analyzing the screen
        const visionFillers = [
            `Your question was: ${input}. I need to view your screen and analyze it, give me a second.`,
            `You asked: ${input}. Let me take a look at your screen and find the answer.`,
            `Okay, you asked ${input}. I need to analyze what's on your screen, one moment please.`,
            `Got it. ${input}. Let me check your screen to find that information for you.`
        ];
        fillerMessage = visionFillers[Math.floor(Math.random() * visionFillers.length)];
    } else {
        // For general questions - repeat question + acknowledge
        const generalFillers = [
            `Your question was: ${input}. Let me think about that for a moment.`,
            `You asked: ${input}. Give me a second to process that for you.`,
            `Okay, ${input}. Let me work on that for you.`,
            `Got it. ${input}. One moment while I figure that out.`
        ];
        fillerMessage = generalFillers[Math.floor(Math.random() * generalFillers.length)];
    }
    
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
    
    // Start speaking filler immediately and track the promise
    const fillerStartTime = Date.now();
    console.log('=== FILLER START ===', new Date().toISOString());
    const fillerPromise = speak(fillerMessage, false).catch(err => {
        console.warn('Filler error:', err);
        // Return resolved promise so we don't hang
        return Promise.resolve();
    });

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

        // Check if filler is still playing - if not, start response immediately
        const responseReceivedTime = Date.now();
        const timeSinceFillerStart = responseReceivedTime - fillerStartTime;
        console.log(`⏱️ Time since filler started: ${timeSinceFillerStart}ms`);
        console.log('Current audio queue length:', currentAudioQueue.length);
        console.log('Is playing audio:', isPlayingAudio);

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
                // Check if filler is still playing - if not, start immediately
                const responseAudioStartTime = Date.now();
                console.log('=== CHECKING FILLER STATUS ===', new Date().toISOString());
                console.log('Filler promise state:', fillerPromise);
                console.log('Message text length:', messageText.length);
                console.log('Message text preview:', messageText.substring(0, 100));
                
                try {
                    // Check if filler is still playing by checking audio queue
                    const fillerStillPlaying = isPlayingAudio && currentAudioQueue.length > 0;
                    console.log('Filler still playing?', fillerStillPlaying);
                    
                    if (fillerStillPlaying) {
                        // Filler is still playing - wait for it to finish
                        console.log('⏳ Filler still playing - waiting for it to finish...');
                        const waitStartTime = Date.now();
                        await Promise.race([
                            fillerPromise.then(() => {
                                const waitTime = Date.now() - waitStartTime;
                                console.log(`✅ Filler promise resolved after ${waitTime}ms - starting response`);
                                return Promise.resolve();
                            }),
                            new Promise(resolve => setTimeout(() => {
                                console.warn('⚠️ Filler timeout after 10s - proceeding with response');
                                resolve();
                            }, 10000))
                        ]);
                    } else {
                        // Filler already finished - start response immediately
                        console.log('✅ Filler already finished - starting response immediately');
                        // Make sure filler promise is resolved (in case it finished but promise hasn't resolved yet)
                        try {
                            await Promise.race([
                                fillerPromise,
                                Promise.resolve() // Resolve immediately if filler already done
                            ]);
                        } catch (e) {
                            // Ignore - filler is done anyway
                        }
                    }

                    const timeBeforeSpeak = Date.now() - responseAudioStartTime;
                    console.log(`⏱️ Time to start response audio: ${timeBeforeSpeak}ms`);
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

        // Clear the filler timeout
        if (fillerTimeout) {
            clearTimeout(fillerTimeout);
            fillerTimeout = null;
        }

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
 * Play audio from base64 encoded data (from backend TTS)
 * @param {string} audioBase64 - Base64 encoded audio data
 * @param {string} format - Audio MIME type (default: audio/mp3)
 */
function playAudioFromBase64(audioBase64, format = 'audio/mp3') {
    if (isMuted || !audioBase64) {
        console.log('[TTS] Skipping backend audio playback (muted or no data)');
        return;
    }
    
    console.log(`[TTS] Playing backend audio (${audioBase64.length} chars base64, format: ${format})`);
    
    try {
        // Convert base64 to blob
        const binaryString = atob(audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: format });
        
        // Create audio and play
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        // Add to queue
        currentAudioQueue.push(audio);
        isPlayingAudio = true;
        
        audio.onended = () => {
            console.log('[TTS] Backend audio playback finished');
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
        };
        
        audio.onerror = (error) => {
            console.error('[TTS] Backend audio playback error:', error);
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
        };
        
        audio.play().catch((error) => {
            console.error('[TTS] Failed to play backend audio:', error);
            URL.revokeObjectURL(audioUrl);
            currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
            isPlayingAudio = currentAudioQueue.length > 0;
        });
        
    } catch (error) {
        console.error('[TTS] Failed to decode backend audio:', error);
    }
}

/**
 * Speak text using Web Speech Synthesis (browser TTS)
 * This is used as a fallback when backend doesn't provide TTS audio
 * Primary TTS is done by the Python backend using Deepgram
 */
async function speak(text, stopExisting = true) {
    console.log('🔊 speak() called (frontend fallback):', {
        textLength: text ? text.length : 0,
        textPreview: text ? text.substring(0, 50) : 'null',
        stopExisting: stopExisting,
        isMuted: isMuted
    });
    
    if (!text || typeof text !== 'string' || !text.trim()) {
        console.log('❌ Invalid or empty text, skipping speech');
        return Promise.resolve();
    }
    
    if (isMuted) {
        console.log('🔇 Muted, skipping speech');
        return Promise.resolve();
    }

    // Stop any ongoing speech if requested
    if (stopExisting) {
        stopAllAudio();
        window.speechSynthesis?.cancel();
        currentAudioQueue = [];
        isPlayingAudio = false;
    }

    // Use Web Speech Synthesis (browser TTS) as fallback
    // Primary TTS is handled by the backend
    console.log('▶️ Using Web Speech Synthesis (browser fallback)');
    return speakWithWebSpeech(text);
}

/**
 * Browser TTS fallback using SpeechSynthesis
 * Ensures audio still plays if Deepgram TTS fails or returns empty audio
 */
async function speakWithWebSpeech(text) {
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
