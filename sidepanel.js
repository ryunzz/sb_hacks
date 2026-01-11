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

// State
let isListening = false;
let isMuted = false;
let deepgramSocket = null;
let mediaRecorder = null;
let audioStream = null;
let deepgramApiKey = '';

// TTS state variables
let ttsSocket = null;
let ttsAudioContext = null;
let ttsAudioQueue = [];
let ttsIsPlaying = false;
let ttsCurrentSource = null;
let ttsPendingMessages = [];
let ttsNextStartTime = 0;
const TTS_MODEL = 'aura-thalia-en';
const TTS_ENCODING = 'linear16';
const TTS_SAMPLE_RATE = 16000;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();

    // Announce ready state for screen readers
    announceToScreenReader('Vision Agent is ready. Press and hold the microphone button to speak, or type your message.');
});

/**
 * Load configuration from storage
 */
async function loadConfig() {
    try {
        const config = await chrome.storage.local.get(['deepgramApiKey', 'voiceMuted']);
        deepgramApiKey = config.deepgramApiKey || '';
        isMuted = config.voiceMuted || false;
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

    // Listen for config updates
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.deepgramApiKey) {
            deepgramApiKey = changes.deepgramApiKey.newValue || '';
        }
    });
}

/**
 * Start listening with Deepgram
 */
async function startListening() {
    if (isListening) return;

    // Check for API key
    if (!deepgramApiKey) {
        addMessage('assistant', 'Please set up your Deepgram API key in settings to use voice input. You can still type messages below.');
        speak('Please set up your Deepgram API key in settings to use voice input.');
        return;
    }

    isListening = true;
    voiceBtn.classList.add('listening');
    voiceBtn.querySelector('.voice-text').textContent = 'Listening...';
    setStatus('Listening...');

    try {
        // Get microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000
            }
        });

        // Connect to Deepgram WebSocket (Flux model on v2 endpoint)
        deepgramSocket = new WebSocket(
            'wss://api.deepgram.com/v2/listen?model=flux-general-en&punctuate=true&smart_format=true&encoding=opus&sample_rate=16000',
            ['token', deepgramApiKey]
        );

        let transcript = '';

        deepgramSocket.onopen = () => {
            console.log('Deepgram Flux connected');

            // Start MediaRecorder
            mediaRecorder = new MediaRecorder(audioStream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && deepgramSocket?.readyState === WebSocket.OPEN) {
                    deepgramSocket.send(event.data);
                }
            };

            mediaRecorder.start(80); // Send chunks every 80ms (optimal for Flux)
        };

        deepgramSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.channel?.alternatives?.[0]?.transcript) {
                const newTranscript = data.channel.alternatives[0].transcript;
                if (data.is_final) {
                    transcript += newTranscript + ' ';
                }
            }
        };

        deepgramSocket.onclose = () => {
            console.log('Deepgram disconnected');
            if (transcript.trim()) {
                handleUserInput(transcript.trim());
            }
        };

        deepgramSocket.onerror = (error) => {
            console.error('Deepgram error:', error);
            addMessage('assistant', 'Voice recognition failed. Please try again or type your message.');
            stopListening();
        };

    } catch (error) {
        console.error('Microphone access error:', error);
        addMessage('assistant', 'Could not access microphone. Please check your permissions.');
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

    // Stop media recorder
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    // Close Deepgram connection
    if (deepgramSocket) {
        deepgramSocket.close();
        deepgramSocket = null;
    }

    // Stop audio stream
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
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
async function handleUserInput(input) {
    addMessage('user', input);
    setStatus('Thinking...');

    // Show loading state
    const loadingId = addMessage('assistant', '...', true);

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'message',
            content: input
        });

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
 * Initialize TTS WebSocket connection
 */
async function initTTSConnection() {
    if (ttsSocket && ttsSocket.readyState === WebSocket.OPEN) {
        return true; // Already connected
    }

    try {
        console.log('[TTS] Connecting to Deepgram TTS...');

        // Build WebSocket URL with parameters
        const ttsUrl = `wss://api.deepgram.com/v1/speak?model=${TTS_MODEL}&encoding=${TTS_ENCODING}&sample_rate=${TTS_SAMPLE_RATE}`;

        ttsSocket = new WebSocket(ttsUrl, ['token', deepgramApiKey]);
        ttsSocket.binaryType = 'arraybuffer'; // Receive audio as ArrayBuffer

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('TTS connection timeout'));
            }, 5000);

            ttsSocket.onopen = () => {
                clearTimeout(timeout);
                console.log('[TTS] Connected to Deepgram TTS');

                // Initialize Web Audio API
                if (!ttsAudioContext) {
                    ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                        sampleRate: TTS_SAMPLE_RATE
                    });
                }

                resolve(true);
            };

            ttsSocket.onmessage = handleTTSMessage;

            ttsSocket.onerror = (error) => {
                clearTimeout(timeout);
                console.error('[TTS] WebSocket error:', error);
                reject(error);
            };

            ttsSocket.onclose = (event) => {
                console.log('[TTS] WebSocket closed:', event.code, event.reason);
                ttsSocket = null;

                // Attempt reconnect if not intentional closure and messages pending
                if (event.code !== 1000 && ttsPendingMessages.length > 0) {
                    setTimeout(() => {
                        console.log('[TTS] Attempting reconnect...');
                        const nextMessage = ttsPendingMessages.shift();
                        sendTTSText(nextMessage);
                    }, 1000);
                }
            };
        });
    } catch (error) {
        console.error('[TTS] Connection error:', error);
        return false;
    }
}

/**
 * Handle incoming TTS WebSocket messages (audio chunks)
 */
function handleTTSMessage(event) {
    if (event.data instanceof ArrayBuffer) {
        // Received audio data
        if (event.data.byteLength > 0) {
            ttsAudioQueue.push(event.data);

            // Start playback if not already playing
            if (!ttsIsPlaying) {
                playTTSAudioQueue();
            }
        }
    } else {
        // Received JSON metadata
        try {
            const message = JSON.parse(event.data);
            console.log('[TTS] Metadata:', message);

            if (message.type === 'Flushed') {
                console.log('[TTS] Flush complete, audio queued');
            } else if (message.type === 'Metadata') {
                console.log('[TTS] Audio metadata:', message);
            } else if (message.type === 'Warning') {
                console.warn('[TTS] Warning:', message.warn_msg);
            }
        } catch (e) {
            console.error('[TTS] Failed to parse metadata:', e);
        }
    }
}

/**
 * Play queued TTS audio chunks
 */
async function playTTSAudioQueue() {
    if (ttsIsPlaying || ttsAudioQueue.length === 0 || !ttsAudioContext) {
        return;
    }

    ttsIsPlaying = true;

    try {
        while (ttsAudioQueue.length > 0) {
            if (isMuted) {
                // Clear queue if muted
                ttsAudioQueue = [];
                break;
            }

            const audioData = ttsAudioQueue.shift();

            // Decode audio data
            const audioBuffer = await ttsAudioContext.decodeAudioData(audioData);

            // Create audio source
            const source = ttsAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ttsAudioContext.destination);

            // Track current source for interruption
            ttsCurrentSource = source;

            // Schedule playback
            const currentTime = ttsAudioContext.currentTime;
            const startTime = Math.max(currentTime, ttsNextStartTime);

            // Play audio
            source.start(startTime);

            // Calculate next start time for seamless playback
            ttsNextStartTime = startTime + audioBuffer.duration;

            // Wait for this chunk to finish
            await new Promise(resolve => {
                source.onended = resolve;
            });

            ttsCurrentSource = null;
        }
    } catch (error) {
        console.error('[TTS] Playback error:', error);
    } finally {
        ttsIsPlaying = false;
        ttsNextStartTime = 0;

        // Process next message in queue if any
        if (ttsPendingMessages.length > 0) {
            const nextMessage = ttsPendingMessages.shift();
            sendTTSText(nextMessage);
        }
    }
}

/**
 * Send text to TTS WebSocket
 */
async function sendTTSText(text) {
    if (!text || text.trim().length === 0) {
        return;
    }

    // Truncate if too long (2000 char limit per Deepgram)
    const truncatedText = text.slice(0, 2000);

    // Connect if needed
    const connected = await initTTSConnection();
    if (!connected) {
        console.error('[TTS] Failed to connect, falling back to Web Speech API');
        fallbackToWebSpeech(text);
        return;
    }

    try {
        // Send Speak command
        ttsSocket.send(JSON.stringify({
            type: 'Speak',
            text: truncatedText
        }));

        // Send Flush to trigger audio generation
        ttsSocket.send(JSON.stringify({
            type: 'Flush'
        }));

        console.log('[TTS] Sent text:', truncatedText.substring(0, 50) + (truncatedText.length > 50 ? '...' : ''));
    } catch (error) {
        console.error('[TTS] Send error:', error);
        fallbackToWebSpeech(text);
    }
}

/**
 * Fallback to Web Speech API if TTS fails
 */
function fallbackToWebSpeech(text) {
    console.log('[TTS] Using Web Speech API fallback');

    if (isMuted) return;

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(v =>
        v.name.includes('Samantha') ||
        v.name.includes('Google') ||
        v.name.includes('Microsoft')
    );
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }

    speechSynthesis.speak(utterance);
}

/**
 * Stop current TTS playback
 */
function stopTTSPlayback() {
    // Clear audio queue
    ttsAudioQueue = [];

    // Stop current audio source
    if (ttsCurrentSource) {
        try {
            ttsCurrentSource.stop();
        } catch (e) {
            // Already stopped
        }
        ttsCurrentSource = null;
    }

    ttsIsPlaying = false;
    ttsNextStartTime = 0;

    // Clear pending messages
    ttsPendingMessages = [];

    // Also cancel Web Speech API fallback
    speechSynthesis.cancel();
}

/**
 * Close TTS WebSocket connection
 */
function closeTTSConnection() {
    if (ttsSocket) {
        try {
            ttsSocket.send(JSON.stringify({ type: 'Close' }));
            ttsSocket.close();
        } catch (e) {
            console.error('[TTS] Error closing connection:', e);
        }
        ttsSocket = null;
    }

    stopTTSPlayback();
}

/**
 * Text-to-speech (now using Deepgram WebSocket TTS)
 */
function speak(text) {
    if (isMuted) return;

    // Stop any ongoing speech
    stopTTSPlayback();

    if (!deepgramApiKey) {
        console.warn('[TTS] No API key, using Web Speech fallback');
        fallbackToWebSpeech(text);
        return;
    }

    // If currently playing, queue the message
    if (ttsIsPlaying) {
        console.log('[TTS] Queueing message');
        ttsPendingMessages.push(text);
        return;
    }

    // Send to Deepgram TTS
    sendTTSText(text);
}

/**
 * Toggle mute
 */
function toggleMute() {
    isMuted = !isMuted;
    chrome.storage.local.set({ voiceMuted: isMuted });
    updateMuteButton();

    if (isMuted) {
        stopTTSPlayback(); // Stop Deepgram TTS
        speechSynthesis.cancel(); // Keep for fallback
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

// Load voices when available
speechSynthesis.onvoiceschanged = () => {
    speechSynthesis.getVoices();
};

// Cleanup TTS on page unload
window.addEventListener('beforeunload', () => {
    if (ttsSocket) {
        closeTTSConnection();
    }
});
