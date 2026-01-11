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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();
    setupOffscreenListeners();

    // Announce ready state for screen readers
    announceToScreenReader('Vision Agent is ready. Click the microphone button to start recording, or type your message.');
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

                    // Put transcript in text input for user to review and send manually
                    textInput.value = finalText;

                    // Focus the text input so user can edit or send
                    textInput.focus();

                    setStatus('Review and click Send');
                    announceToScreenReader('Transcript ready. Review and click send or press enter.');
                } else {
                    // No transcript, clear input
                    textInput.value = '';
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

    // Play conversational filler IMMEDIATELY for responsive feel
    const fillerPhrases = [
        "Let me think about that for a moment...",
        "Hmm, interesting question. Give me a second...",
        "Let me analyze this for you...",
        "Just processing that...",
        "One moment while I look into this..."
    ];

    // Start speaking immediately
    const randomFiller = fillerPhrases[Math.floor(Math.random() * fillerPhrases.length)];
    speak(randomFiller);
    
    // Set a timeout reference for cleanup (even though we're not delaying)
    fillerTimeout = setTimeout(() => {}, 0);

    try {
        console.log('Sending message to background:', input);
        const response = await chrome.runtime.sendMessage({
            type: 'message',
            content: input
        });

        console.log('Response received from background:', response);
        console.log('Response type:', response?.type, 'Response keys:', response ? Object.keys(response) : 'null');
        console.log('Response message:', response?.message ? response.message.substring(0, 50) + '...' : 'undefined');

        // Clear the filler timeout
        if (fillerTimeout) {
            clearTimeout(fillerTimeout);
            fillerTimeout = null;
        }

        // Stop any ongoing filler speech
        stopAllAudio();

        // Update loading message with response instead of removing it
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
                speak(response.message);
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
                speak(messageText);
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
                speak(errorText);
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
                    speak(messageText);
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
 * Speak text using Deepgram TTS, chunking if necessary
 */
async function speak(text) {
    if (isMuted || !text.trim()) return;

    // Stop any ongoing speech
    stopAllAudio();

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
        return;
    }
    
    // Ensure we have a valid voice model
    if (!selectedVoice || selectedVoice === 'aura-thalia-en') {
        selectedVoice = 'aura-2-thalia-en';
        console.log('TTS: Fixed voice model to:', selectedVoice);
    }

    try {

        // Split text into chunks if it's too long
        const chunks = chunkText(text.trim(), 1900); // Use 1900 to be safe (under 2000 limit)

        console.log(`TTS: Splitting text into ${chunks.length} chunk(s)`);

        // Process chunks sequentially
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

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
                const errorText = await response.text();
                console.error('TTS API error:', response.status, errorText);

                // For 400 errors (bad model name), fail silently and don't throw
                if (response.status === 400) {
                    console.warn('TTS model not available, skipping speech output');
                    return;
                }

                // For 413 errors (payload too large), try to chunk even smaller
                if (response.status === 413) {
                    console.warn('TTS chunk still too large, splitting further...');
                    // Recursively split this chunk into smaller pieces
                    const smallerChunks = chunkText(chunk, 1000);
                    for (const smallerChunk of smallerChunks) {
                        await speakChunk(smallerChunk);
                    }
                    continue;
                }

                let errorMessage = 'TTS request failed';
                if (response.status === 401) {
                    errorMessage = 'Deepgram API key is invalid. Please check your settings.';
                } else if (response.status === 403) {
                    errorMessage = 'Deepgram API key does not have TTS permissions.';
                } else if (response.status >= 500) {
                    errorMessage = 'Deepgram service is temporarily unavailable. Please try again later.';
                }

                // Don't throw for TTS errors - just log and continue
                console.warn('TTS error (non-critical):', errorMessage);
                return;
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            // Create and play audio
            const audio = new Audio(audioUrl);
            currentAudioQueue.push(audio);

            // Wait for this chunk to finish before playing the next one
            await new Promise((resolve, reject) => {
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                    isPlayingAudio = currentAudioQueue.length > 0;
                    resolve();
                };

                audio.onerror = (error) => {
                    console.error('Audio playback error:', error);
                    URL.revokeObjectURL(audioUrl);
                    currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                    isPlayingAudio = currentAudioQueue.length > 0;
                    reject(error);
                };

                isPlayingAudio = true;
                audio.play().catch(reject);
            });
        }

    } catch (error) {
        console.error('TTS error:', error);
        // Don't show error to user for TTS failures - just log it
        // The text message will still be displayed
    }
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
                Click the microphone button to start recording, or type your message below.
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
