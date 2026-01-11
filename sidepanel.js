/**
 * Vision Agent - Side Panel JavaScript
 * Handles voice input (Deepgram), text-to-speech, and communication with background script
 */

import { speak, stopAllAudio } from './tts.js';

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
let elevenlabsApiKey = '';
let deepgramApiKey = '';
let ttsProvider = 'elevenlabs';
let selectedLanguage = 'en';
let selectedVoice = '21m00Tcm4TlvDq8ikWAM'; // Rachel - ElevenLabs default
let fillerTimeout = null;
let currentUserMessageId = null; // Track the current user message being spoken
let currentLoadingMessageId = null; // Track the loading message for responses
let currentRecognition = null; // Track the current Web Speech Recognition instance

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
                // Note: Web Speech API does not support interim results
                // This case is kept for backward compatibility but unused
                break;

            case 'transcript-result':
                // Final transcript when recording stops - auto-send the message
                console.log('Final transcript received:', message.transcript);

                // Reset listening state
                isListening = false;
                voiceBtn.classList.remove('listening');
                voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
                voiceBtn.setAttribute('aria-label', 'Start recording');
                voiceBtn.setAttribute('title', 'Click to start recording');

                if (message.transcript && message.transcript.trim()) {
                    const finalText = message.transcript.trim();

                    // Add user message with final transcript
                    addMessage('user', finalText);

                    // Auto-send the message immediately
                    console.log('Auto-sending transcript:', finalText);
                    handleUserInput(finalText);
                    setStatus('Message sent');
                } else {
                    setStatus('Ready to help');
                }
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
                speakText('Microphone permission granted. You can now use voice input.');
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
            'elevenlabsApiKey',
            'deepgramApiKey',
            'ttsProvider',
            'voiceMuted',
            'language',
            'voiceId'
        ]);
        elevenlabsApiKey = config.elevenlabsApiKey || '';
        deepgramApiKey = config.deepgramApiKey || '';
        ttsProvider = config.ttsProvider || 'elevenlabs';
        isMuted = config.voiceMuted || false;
        selectedLanguage = config.language || 'en';
        selectedVoice = config.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
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
        if (changes.elevenlabsApiKey) {
            elevenlabsApiKey = changes.elevenlabsApiKey.newValue || '';
        }
        if (changes.deepgramApiKey) {
            deepgramApiKey = changes.deepgramApiKey.newValue || '';
        }
        if (changes.ttsProvider) {
            ttsProvider = changes.ttsProvider.newValue || 'elevenlabs';
        }
        if (changes.language) {
            selectedLanguage = changes.language.newValue || 'en';
        }
        if (changes.voiceId) {
            selectedVoice = changes.voiceId.newValue || '21m00Tcm4TlvDq8ikWAM';
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
    speakText('Opening microphone permission page. Please allow microphone access when prompted.');
}

/**
 * Start listening via offscreen document
 */
async function startListening() {
    if (isListening) return;

    // Note: No API key needed for Web Speech API (browser-native)

    // Check microphone permission first
    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
        addMessage('assistant', 'Microphone permission is required. Opening permission request page...');
        speakText('Microphone permission is required. Opening permission request page.');
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
        // Use Web Speech API directly in sidepanel (not offscreen)
        // Web Speech API requires direct user gesture context
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            throw new Error('Web Speech API is not supported in this browser. Please use Chrome or Edge.');
        }

        currentRecognition = new SpeechRecognition();
        currentRecognition.continuous = false;
        currentRecognition.interimResults = false;
        currentRecognition.lang = mapLanguageCode(selectedLanguage);
        currentRecognition.maxAlternatives = 1;

        currentRecognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log('Web Speech: Final transcript:', transcript);

            if (transcript && transcript.trim()) {
                addMessage('user', transcript.trim());
                handleUserInput(transcript.trim());
                setStatus('Message sent');
            }

            isListening = false;
            voiceBtn.classList.remove('listening');
            voiceBtn.querySelector('.voice-text').textContent = 'Start Recording';
            currentRecognition = null;
        };

        currentRecognition.onerror = (event) => {
            console.error('Web Speech error:', event.error);
            let errorMessage = 'Speech recognition failed. Please try again.';

            if (event.error === 'no-speech') {
                errorMessage = 'No speech detected. Please try again and speak clearly.';
            } else if (event.error === 'not-allowed') {
                errorMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.';
            } else if (event.error === 'network') {
                errorMessage = 'Network error. Web Speech API requires internet connection.';
            }

            addMessage('assistant', errorMessage);
            stopListening();
        };

        currentRecognition.onend = () => {
            console.log('Web Speech: Recognition ended');
            if (isListening) {
                stopListening();
            }
        };

        currentRecognition.start();
        console.log('Web Speech: Started recognition');

    } catch (error) {
        console.error('Start recording error:', error);
        const errorMsg = error.message || 'Could not start speech recognition. Please check your browser settings.';
        addMessage('assistant', errorMsg);
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

    // Stop the Web Speech Recognition instance
    if (currentRecognition) {
        currentRecognition.stop();
        currentRecognition = null;
    }
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
async function handleUserInput(input, existingUserMessageId = null) {
    // Reset any voice-related state when switching to text mode
    if (!existingUserMessageId) {
        // This is a text input, not voice - reset voice state
        currentUserMessageId = null;
        addMessage('user', input);
    }
    
    setStatus('Thinking...');

    // Show loading state with animated dots
    currentLoadingMessageId = addMessage('assistant', '...', true);

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
        speakText(randomFiller);
    }, 400);

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
                loadingEl.classList.remove('loading');
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
            speakText('No response received. Please check your API keys and try again.');
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
                    const contentEl = loadingEl.querySelector('.message-content');
                    if (contentEl) {
                        contentEl.textContent = errorText;
                    }
                }
            } else {
                addMessage('assistant', errorText);
            }
            if (response.message) {
                speakText(response.message);
            }
        } else if (response.type === 'response') {
            const messageText = response.message || response.text || '';
            if (messageText) {
                console.log('Success response:', messageText.substring(0, 100));
                // Update loading message with actual response
                if (currentLoadingMessageId) {
                    const loadingEl = document.getElementById(currentLoadingMessageId);
                    if (loadingEl) {
                        const contentEl = loadingEl.querySelector('.message-content');
                        if (contentEl) {
                            contentEl.textContent = messageText;
                        }
                    }
                } else {
                    addMessage('assistant', messageText);
                }
                speakText(messageText);
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
                speakText(errorText);
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
                if (messageText) {
                    console.log('Response (fallback):', messageText.substring(0, 100));
                    if (currentLoadingMessageId) {
                        const loadingEl = document.getElementById(currentLoadingMessageId);
                        if (loadingEl) {
                            const contentEl = loadingEl.querySelector('.message-content');
                            if (contentEl) {
                                contentEl.textContent = messageText;
                            }
                        }
                    } else {
                        addMessage('assistant', messageText);
                    }
                    speakText(messageText);
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
                    speakText(errorText);
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
        speakText('Something went wrong. Please try again.');
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
async function speakText(text) {
    if (isMuted) return;
    await speak(text, ttsProvider, elevenlabsApiKey, deepgramApiKey, selectedVoice);
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
 * Map language codes from ISO 639-1 to BCP 47 format for Web Speech API
 */
function mapLanguageCode(lang) {
    const languageMap = {
        'en': 'en-US',
        'es': 'es-ES',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'it': 'it-IT',
        'pt': 'pt-BR',
        'nl': 'nl-NL',
        'pl': 'pl-PL',
        'ru': 'ru-RU',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'zh': 'zh-CN',
        'hi': 'hi-IN',
        'ar': 'ar-SA'
    };
    return languageMap[lang] || 'en-US';
}
