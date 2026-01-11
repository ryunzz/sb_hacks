/**
 * Offscreen Document for Audio Capture
 * Handles speech recognition using Web Speech API
 */

let isReady = false;
let isRecording = false;
let recognition = null;

// Signal that offscreen document is ready
console.log('Offscreen document loaded');
isReady = true;
chrome.runtime.sendMessage({ type: 'offscreen-ready' });

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Offscreen: Received message:', message.type, message);

    // Handle async operations
    (async () => {
        switch (message.type) {
            case 'start-recording':
                // Ensure we're ready before starting
                if (!isReady) {
                    sendResponse({ success: false, error: 'Offscreen document not ready' });
                    return;
                }

                // Prevent multiple simultaneous recordings
                if (isRecording) {
                    console.warn('Offscreen: Recording already in progress, ignoring duplicate start request');
                    sendResponse({ success: false, error: 'Recording already in progress' });
                    return;
                }

                console.log('Offscreen: Starting Web Speech API recording:', {
                    language: message.language
                });

                try {
                    await startRecording(message.language || 'en');
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Offscreen: Start recording error:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'stop-recording':
                try {
                    stopRecording();
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Offscreen: Stop recording error:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            default:
                console.log('Offscreen: Unhandled message type:', message.type);
        }
    })();

    // Must return true to indicate async response
    return true;
});

/**
 * Start speech recognition using Web Speech API
 */
async function startRecording(language = 'en') {
    if (isRecording) {
        console.warn('Recording already in progress');
        return;
    }

    isRecording = true;

    try {
        // Check if Web Speech API is available
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            throw new Error('Web Speech API is not supported in this browser. Please use Chrome or Edge.');
        }

        // Create recognition instance
        recognition = new SpeechRecognition();
        recognition.continuous = false;  // Batch mode - wait for user to stop
        recognition.interimResults = false;  // No interim results
        recognition.lang = mapLanguageCode(language);  // Map 'en' → 'en-US'
        recognition.maxAlternatives = 1;

        console.log('Web Speech: Configured recognition:', {
            continuous: recognition.continuous,
            interimResults: recognition.interimResults,
            lang: recognition.lang
        });

        // Handle successful transcription
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            const confidence = event.results[0][0].confidence;

            console.log('Web Speech: Final transcript:', {
                transcript: transcript,
                confidence: confidence,
                resultsLength: event.results.length
            });

            chrome.runtime.sendMessage({
                type: 'transcript-result',
                transcript: transcript
            });

            isRecording = false;
        };

        // Handle errors
        recognition.onerror = (event) => {
            console.error('Web Speech error:', event.error);
            let errorMessage = getErrorMessage(event.error);

            chrome.runtime.sendMessage({
                type: 'recording-error',
                error: errorMessage
            });

            isRecording = false;
        };

        // Handle end of recognition
        recognition.onend = () => {
            console.log('Web Speech: Recognition ended');
            isRecording = false;
        };

        // Start recognition
        recognition.start();
        console.log('Web Speech: Started recognition');

        chrome.runtime.sendMessage({ type: 'recording-started' });

    } catch (error) {
        console.error('Start recording error:', error);
        isRecording = false;
        chrome.runtime.sendMessage({
            type: 'recording-error',
            error: error.message
        });
        throw error;
    }
}

/**
 * Stop speech recognition
 */
function stopRecording() {
    console.log('Stop recording called');
    isRecording = false;

    if (recognition) {
        recognition.stop();
        recognition = null;
    }
}

/**
 * Map language codes from ISO 639-1 to BCP 47 format
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

/**
 * Get user-friendly error message for Web Speech API errors
 */
function getErrorMessage(errorType) {
    const errorMessages = {
        'no-speech': 'No speech detected. Please try again and speak clearly.',
        'audio-capture': 'Microphone not accessible. Please check your microphone settings.',
        'not-allowed': 'Microphone permission denied. Please allow microphone access in your browser settings.',
        'network': 'Network error. Web Speech API requires internet connection.',
        'aborted': 'Speech recognition was aborted.',
        'language-not-supported': 'This language is not supported. Please try English.'
    };
    return errorMessages[errorType] || 'Speech recognition failed. Please try again.';
}

console.log('Offscreen: Web Speech API handler initialized');
