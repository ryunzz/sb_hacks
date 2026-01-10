/**
 * Offscreen Document for Audio Capture
 * Handles microphone access in a context where Chrome allows getUserMedia
 */

let mediaRecorder = null;
let audioStream = null;
let isReady = false;

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
                
                // Log API key status (without exposing the actual key)
                console.log('Offscreen: API key received in message:', {
                    hasApiKey: !!message.deepgramApiKey,
                    apiKeyType: typeof message.deepgramApiKey,
                    apiKeyLength: message.deepgramApiKey ? message.deepgramApiKey.length : 0,
                    apiKeyPreview: message.deepgramApiKey ? message.deepgramApiKey.substring(0, 10) + '...' : 'none',
                    language: message.language
                });
                
                // Get API key from message, or fetch from storage as fallback
                let apiKey = message.deepgramApiKey;
                
                // If API key is missing from message, try to get it from storage
                if (!apiKey || apiKey.trim() === '') {
                    console.log('Offscreen: API key missing from message, fetching from storage...');
                    try {
                        const stored = await chrome.storage.local.get(['deepgramApiKey']);
                        apiKey = stored.deepgramApiKey || '';
                        console.log('Offscreen: Fetched from storage:', {
                            hasApiKey: !!apiKey,
                            apiKeyLength: apiKey ? apiKey.length : 0
                        });
                    } catch (storageError) {
                        console.error('Offscreen: Failed to fetch from storage:', storageError);
                    }
                }
                
                // Final check if API key exists
                if (!apiKey || apiKey.trim() === '') {
                    const error = 'Deepgram API key is missing. Please configure it in settings.';
                    console.error('Offscreen:', error);
                    sendResponse({ success: false, error });
                    return;
                }
                
                try {
                    await startRecording(apiKey, message.language || 'en');
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Recording start error:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'stop-recording':
                stopRecording();
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ error: 'Unknown message type' });
        }
    })();
    
    return true; // Indicates we will send a response asynchronously
});

/**
 * Start recording audio and stream to Deepgram
 */
async function startRecording(deepgramApiKey, language = 'en') {
    try {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('getUserMedia is not available in this context');
        }

        // Check permission state first (if available)
        let permissionState = 'prompt';
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            permissionState = result.state;
            console.log('Microphone permission state:', permissionState);
            
            // If permission was previously denied, provide helpful message
            if (permissionState === 'denied') {
                throw new Error('PERMISSION_DENIED_PERSISTENT');
            }
        } catch (permError) {
            // Permissions API might not be available, continue anyway
            if (permError.message === 'PERMISSION_DENIED_PERSISTENT') {
                throw permError;
            }
            console.log('Permissions API not available, proceeding with getUserMedia');
        }

        console.log('Requesting microphone access...');
        
        // Request microphone access with explicit permission request
        // This should trigger Chrome's permission prompt if not already granted
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        console.log('Microphone access granted');

        // Validate API key
        if (!deepgramApiKey || deepgramApiKey.trim() === '') {
            throw new Error('Deepgram API key is required');
        }

        // Connect to Deepgram WebSocket
        // Deepgram WebSocket API uses Sec-WebSocket-Protocol header with subprotocols
        // Format: ['token', 'YOUR_API_KEY']
        // Reference: https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
        const languageParam = language !== 'en' ? `&language=${language}` : '';
        const deepgramUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&smart_format=true${languageParam}`;
        
        console.log('Connecting to Deepgram WebSocket...');
        console.log('Deepgram URL:', deepgramUrl);
        console.log('Using API key (length):', deepgramApiKey.trim().length);
        
        // Deepgram requires the token as a subprotocol in Sec-WebSocket-Protocol header
        const deepgramSocket = new WebSocket(deepgramUrl, ['token', deepgramApiKey.trim()]);
        
        // Set a connection timeout (store in window for cleanup)
        let connectionTimeout = setTimeout(() => {
            if (deepgramSocket.readyState !== WebSocket.OPEN) {
                console.error('Deepgram WebSocket connection timeout');
                deepgramSocket.close();
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: 'Deepgram connection timeout. Please check your API key and network connection.'
                });
                stopRecording();
            }
        }, 10000); // 10 second timeout
        
        // Store timeout for cleanup
        window.deepgramConnectionTimeout = connectionTimeout;

        let transcript = '';

        deepgramSocket.onopen = () => {
            console.log('Offscreen: Deepgram connected successfully');
            if (window.deepgramConnectionTimeout) {
                clearTimeout(window.deepgramConnectionTimeout);
                window.deepgramConnectionTimeout = null;
            }

            // Start MediaRecorder
            try {
                mediaRecorder = new MediaRecorder(audioStream, {
                    mimeType: 'audio/webm;codecs=opus'
                });

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0 && deepgramSocket?.readyState === WebSocket.OPEN) {
                        deepgramSocket.send(event.data);
                    }
                };

                mediaRecorder.onerror = (error) => {
                    console.error('MediaRecorder error:', error);
                    chrome.runtime.sendMessage({
                        type: 'recording-error',
                        error: 'Audio recording error'
                    });
                };

                mediaRecorder.start(250); // Send chunks every 250ms
                console.log('MediaRecorder started');

                // Notify sidepanel that recording started
                chrome.runtime.sendMessage({ type: 'recording-started' });
            } catch (error) {
                console.error('Failed to start MediaRecorder:', error);
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: 'Failed to start audio recording: ' + error.message
                });
                stopRecording();
            }
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

        deepgramSocket.onclose = (event) => {
            console.log('Offscreen: Deepgram disconnected', event.code, event.reason);
            
            // Clean up timeout if still exists
            if (window.deepgramConnectionTimeout) {
                clearTimeout(window.deepgramConnectionTimeout);
                window.deepgramConnectionTimeout = null;
            }
            
            // If closed unexpectedly (not normal closure), send error
            if (event.code !== 1000 && event.code !== 1001) {
                let errorMsg = 'Deepgram connection closed unexpectedly';
                
                // WebSocket close codes:
                // 1006 = Abnormal closure (no close frame received) - usually network/connection issue
                // 1008 = Policy violation - often authentication failure
                // 1002 = Protocol error
                // 1003 = Unsupported data
                // 1011 = Internal server error
                // 1012 = Service restart
                // 1013 = Try again later
                // 1014 = Bad gateway
                // 1015 = TLS handshake failure
                
                if (event.code === 1008) {
                    errorMsg = 'Deepgram authentication failed. Please check your API key in settings.';
                } else if (event.code === 1006) {
                    // 1006 usually means connection was lost - could be network or server issue
                    errorMsg = 'Deepgram connection lost. This could be due to:\n' +
                        '1. Network connectivity issues\n' +
                        '2. Invalid API key\n' +
                        '3. Deepgram service temporarily unavailable\n\n' +
                        'Please check your API key and network connection, then try again.';
                } else if (event.code === 1002 || event.code === 1003) {
                    errorMsg = 'Deepgram protocol error. Please verify your API key is correct.';
                } else if (event.code >= 1011 && event.code <= 1015) {
                    errorMsg = 'Deepgram service error. Please try again in a moment.';
                }
                
                console.error('Deepgram close event details:', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean,
                    hasApiKey: !!deepgramApiKey,
                    apiKeyLength: deepgramApiKey ? deepgramApiKey.length : 0
                });
                
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: errorMsg
                });
            } else if (transcript.trim()) {
                // Normal closure - send transcript
                chrome.runtime.sendMessage({
                    type: 'transcript-result',
                    transcript: transcript.trim()
                });
            } else {
                // Normal closure but no transcript - user might have stopped recording
                console.log('Recording stopped normally with no transcript');
            }
        };

        deepgramSocket.onerror = (error) => {
            console.error('Offscreen: Deepgram WebSocket error event:', error);
            if (window.deepgramConnectionTimeout) {
                clearTimeout(window.deepgramConnectionTimeout);
                window.deepgramConnectionTimeout = null;
            }
            
            // Note: WebSocket onerror doesn't provide much detail
            // The actual error will be in onclose with the close code
            // But we can check the readyState and API key
            
            const readyState = deepgramSocket.readyState;
            let errorMessage = 'Deepgram connection error';
            
            // Check if we have an API key
            if (!deepgramApiKey || deepgramApiKey.trim() === '') {
                errorMessage = 'Deepgram API key is missing. Please configure it in settings.';
            } else if (readyState === WebSocket.CLOSED || readyState === WebSocket.CLOSING) {
                // Connection already closed - onclose will handle the detailed error
                errorMessage = 'Deepgram connection failed. Please check your API key and network connection.';
            } else {
                // Connection error - likely network or authentication issue
                errorMessage = 'Deepgram connection error. Please verify your API key is correct in settings.';
            }
            
            console.error('Deepgram error details:', {
                readyState,
                hasApiKey: !!deepgramApiKey,
                apiKeyLength: deepgramApiKey ? deepgramApiKey.length : 0,
                apiKeyPrefix: deepgramApiKey ? deepgramApiKey.substring(0, 10) + '...' : 'none'
            });
            
            // Only send error if socket is already closed (onclose might not fire in some cases)
            // Otherwise, let onclose handle it with more details
            if (readyState === WebSocket.CLOSED) {
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: errorMessage
                });
                stopRecording();
            }
            // If not closed yet, wait for onclose to provide more specific error
        };

        // Store socket reference for cleanup
        window.deepgramSocket = deepgramSocket;

    } catch (error) {
        console.error('Offscreen: Microphone error:', error.name, error.message);
        let errorMessage = 'Microphone access failed';
        let showSettingsLink = false;
        
        if (error.name === 'NotAllowedError' || error.message === 'PERMISSION_DENIED_PERSISTENT') {
            errorMessage = 'Microphone permission denied. To fix this:\n\n' +
                '1. Click the lock/padlock icon in Chrome\'s address bar\n' +
                '2. Find "Microphone" and change it to "Allow"\n' +
                '3. Or go to: chrome://settings/content/microphone\n' +
                '4. Make sure "Sites can ask to use your microphone" is enabled\n' +
                '5. Remove this extension from the "Not allowed" list if present\n\n' +
                'After changing settings, reload the extension and try again.';
            showSettingsLink = true;
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No microphone found. Please connect a microphone and try again.';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'Microphone is being used by another application. Please close other apps using the microphone.';
        } else {
            errorMessage = `Microphone error: ${error.message}`;
        }
        
        chrome.runtime.sendMessage({
            type: 'recording-error',
            error: errorMessage,
            showSettingsLink: showSettingsLink
        });
        throw error;
    }
}

/**
 * Stop recording
 */
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    mediaRecorder = null;

    if (window.deepgramSocket) {
        window.deepgramSocket.close();
        window.deepgramSocket = null;
    }

    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
}
