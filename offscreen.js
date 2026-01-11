/**
 * Offscreen Document for Audio Capture
 * Handles microphone access in a context where Chrome allows getUserMedia
 */

let mediaRecorder = null;
let audioStream = null;
let isReady = false;
let isRecording = false; // Track if recording is in progress
let currentDeepgramSocket = null; // Track current Deepgram socket

// Transcript state - must be module-level for proper persistence between recordings
let transcript = '';
let lastInterimTranscript = '';

// Signal that offscreen document is ready
console.log('Offscreen document loaded');
isReady = true;
chrome.runtime.sendMessage({ type: 'offscreen-ready' });

// Listen for messages from the background script
// IMPORTANT: Only handle messages with 'offscreen-' prefix (from background script)
// This avoids race conditions with sidepanel's 'start-recording' messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only handle messages meant for this offscreen document (prefixed with 'offscreen-')
    if (message.type !== 'offscreen-start-recording' && message.type !== 'offscreen-stop-recording') {
        // Return false to indicate we're not handling this message
        return false;
    }

    console.log('Offscreen: Received message:', message.type);

    // Handle async operations
    (async () => {
    switch (message.type) {
            case 'offscreen-start-recording':
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

                // Log API key status (without exposing the actual key)
                console.log('Offscreen: API key received in message:', {
                    hasApiKey: !!message.deepgramApiKey,
                    apiKeyType: typeof message.deepgramApiKey,
                    apiKeyLength: message.deepgramApiKey ? message.deepgramApiKey.length : 0,
                    language: message.language
                });

                // Get API key from message (offscreen documents have limited chrome.storage access)
                let apiKey = message.deepgramApiKey || '';

                // Validate API key is present and not empty
                if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
                    console.error('Offscreen: API key validation failed - key is missing or invalid');
                    isRecording = false;
                    const errorMsg = 'Deepgram API key is required. Please open extension settings (click the gear icon) and enter your Deepgram API key.';
                    sendResponse({
                        success: false,
                        error: errorMsg
                    });
                    chrome.runtime.sendMessage({
                        type: 'recording-error',
                        error: errorMsg
                    }).catch(err => console.error('Failed to send recording error:', err));
                    return;
                }

                // Trim whitespace
                apiKey = apiKey.trim();

                console.log('Offscreen: API key validated successfully, proceeding with recording...');

                try {
                    await startRecording(apiKey, message.language || 'en');
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Recording start error:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'offscreen-stop-recording':
            stopRecording();
            sendResponse({ success: true });
            break;
    }
    })();

    return true; // Indicates we will send a response asynchronously
});

/**
 * Start recording audio and stream to Deepgram
 */
async function startRecording(deepgramApiKey, language = 'en') {
    // FIRST: Reset all transcript state for a completely fresh recording
    // This MUST happen before any other operations to prevent carryover
    console.log('Offscreen: Resetting transcript state for new recording');
    transcript = '';
    lastInterimTranscript = '';
    window.transcriptAlreadySent = false;
    
    // Log to verify reset
    console.log('Offscreen: Transcript state reset - transcript:', transcript, 'lastInterim:', lastInterimTranscript);
    
    // Double-check: Force clear any lingering state
    if (transcript || lastInterimTranscript) {
        console.warn('Offscreen: WARNING - Transcript state not properly cleared! Forcing clear...');
        transcript = '';
        lastInterimTranscript = '';
    }

    // Prevent multiple simultaneous recordings
    if (isRecording) {
        console.warn('Offscreen: Recording already in progress, stopping previous session first');
        stopRecording();
        // Wait for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 600));
        // After stopping, ensure transcript is still clear
        transcript = '';
        lastInterimTranscript = '';
    }

    // Ensure any leftover socket is cleaned up and transcript is cleared
    if (window.deepgramSocket) {
        console.warn('Offscreen: Cleaning up leftover WebSocket from previous session');
        try {
            if (window.deepgramSocket.readyState === WebSocket.OPEN || window.deepgramSocket.readyState === WebSocket.CONNECTING) {
                window.deepgramSocket.close();
            }
        } catch (error) {
            console.error('Error closing leftover socket:', error);
        }
        window.deepgramSocket = null;
        currentDeepgramSocket = null;
        // Clear transcript when cleaning up old socket (redundant but safe)
        transcript = '';
        lastInterimTranscript = '';
    }
    
    // Set a flag to track when recording actually starts (after WebSocket opens)
    // This helps us distinguish between old and new transcripts
    window.recordingSessionId = Date.now();
    window.recordingStartTime = Date.now();
    console.log('Offscreen: New recording session ID:', window.recordingSessionId);
    
    // CRITICAL: Set transcript to empty string one more time right before WebSocket opens
    // This ensures no old data can leak in
    transcript = '';
    lastInterimTranscript = '';

    // Ensure all state is reset
    if (mediaRecorder) {
        mediaRecorder = null;
    }
    if (audioStream) {
        try {
            audioStream.getTracks().forEach(track => track.stop());
        } catch (error) {
            // Ignore errors if tracks are already stopped
        }
        audioStream = null;
    }

    // Set recording flag
    isRecording = true;

    try {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            isRecording = false;
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
        // Note: Some browsers may ignore specific constraints, so we request what we want
        // but accept what we get
        const audioConstraints = {
            audio: {
                echoCancellation: true,  // Remove echo
                noiseSuppression: true,  // Remove background noise
                autoGainControl: true,   // Normalize volume
                channelCount: { ideal: 1 },  // Mono audio (sufficient for speech)
                sampleRate: { ideal: 48000 },  // Higher quality (Deepgram handles downsampling)
                // Request higher quality audio for better transcription
                sampleSize: { ideal: 16 }
            }
        };

        console.log('Requesting microphone with constraints:', audioConstraints);
        audioStream = await navigator.mediaDevices.getUserMedia(audioConstraints);

        console.log('Microphone access granted');
        console.log('Audio stream details:', {
            id: audioStream.id,
            active: audioStream.active,
            tracks: audioStream.getTracks().map(track => ({
                kind: track.kind,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState,
                settings: track.getSettings()
            }))
        });

        // Validate API key
        if (!deepgramApiKey || deepgramApiKey.trim() === '') {
            throw new Error('Deepgram API key is required');
        }

        // Connect to Deepgram WebSocket
        // Deepgram WebSocket API uses Sec-WebSocket-Protocol header with subprotocols
        // Format: ['token', 'YOUR_API_KEY']
        // Reference: https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
        const languageParam = language !== 'en' ? `&language=${language}` : '';
        // Enhanced Deepgram WebSocket API configuration for better accuracy
        // - model=nova-2: Latest and most accurate model
        // - punctuate=true: Add punctuation
        // - smart_format=true: Format numbers, dates, etc.
        // - interim_results=true: Real-time transcription
        // - diarize=false: Single speaker (faster, more accurate for single user)
        // - filler_words=false: Remove um, uh, etc. for cleaner output
        // - utterance_end_ms=1500: Wait 1.5s of silence before finalizing (better for natural pauses)
        // - endpointing=300: Detect end of speech after 300ms of silence
        const deepgramUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&smart_format=true&interim_results=true&diarize=false&filler_words=false&utterance_end_ms=1500&endpointing=300${languageParam}`;

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

        // Note: transcript state is reset at the start of startRecording()

        deepgramSocket.onopen = () => {
            console.log('Offscreen: Deepgram connected successfully');
            if (window.deepgramConnectionTimeout) {
                clearTimeout(window.deepgramConnectionTimeout);
                window.deepgramConnectionTimeout = null;
            }

            // Check if audioStream is still valid (might have been stopped)
            if (!audioStream || !isRecording) {
                console.warn('Offscreen: Audio stream no longer valid or recording stopped, closing Deepgram connection');
                deepgramSocket.close();
                return;
            }

            // Start MediaRecorder
            try {
                // Check available MIME types
                const supportedTypes = [
                    'audio/webm;codecs=opus',
                    'audio/webm',
                    'audio/ogg;codecs=opus',
                    'audio/ogg'
                ];

                let selectedMimeType = null;
                for (const mimeType of supportedTypes) {
                    if (MediaRecorder.isTypeSupported(mimeType)) {
                        selectedMimeType = mimeType;
                        break;
                    }
                }

                if (!selectedMimeType) {
                    // Fallback to browser default
                    selectedMimeType = '';
                }

                console.log('MediaRecorder: Using MIME type:', selectedMimeType || 'browser default');

                // Double-check audioStream is still valid
                if (!audioStream || audioStream.getTracks().length === 0) {
                    console.error('Offscreen: Audio stream is invalid, cannot start MediaRecorder');
                    deepgramSocket.close();
                    return;
                }

                console.log('MediaRecorder: Audio stream tracks:', audioStream.getTracks().map(t => ({
                    kind: t.kind,
                    enabled: t.enabled,
                    muted: t.muted,
                    readyState: t.readyState,
                    settings: t.getSettings()
                })));

            mediaRecorder = new MediaRecorder(audioStream, {
                    mimeType: selectedMimeType
                });

                let totalBytesSent = 0;
                let chunkCount = 0;

                mediaRecorder.ondataavailable = async (event) => {
                    if (event.data && event.data.size > 0) {
                        chunkCount++;
                        totalBytesSent += event.data.size;

                        console.log(`MediaRecorder: Chunk ${chunkCount} - Size: ${event.data.size} bytes, Total: ${totalBytesSent} bytes`);

                        if (deepgramSocket?.readyState === WebSocket.OPEN) {
                            try {
                                // Deepgram WebSocket expects binary data (ArrayBuffer or Blob)
                                // Convert Blob to ArrayBuffer for more reliable transmission
                                const arrayBuffer = await event.data.arrayBuffer();
                                deepgramSocket.send(arrayBuffer);
                                console.log(`MediaRecorder: Sent chunk ${chunkCount} to Deepgram (${arrayBuffer.byteLength} bytes)`);
                            } catch (sendError) {
                                console.error('MediaRecorder: Failed to send chunk:', sendError);
                                // Fallback: try sending as Blob directly
                                try {
                    deepgramSocket.send(event.data);
                                    console.log(`MediaRecorder: Sent chunk ${chunkCount} as Blob fallback`);
                                } catch (fallbackError) {
                                    console.error('MediaRecorder: Both ArrayBuffer and Blob send failed:', fallbackError);
                                }
                            }
                        } else {
                            console.warn(`MediaRecorder: Deepgram socket not open (state: ${deepgramSocket?.readyState}), dropping chunk`);
                        }
                    } else {
                        console.warn('MediaRecorder: Received empty data chunk');
                    }
                };

                mediaRecorder.onerror = (error) => {
                    console.error('MediaRecorder error:', error);
                    chrome.runtime.sendMessage({
                        type: 'recording-error',
                        error: 'Audio recording error: ' + (error.error?.message || 'Unknown error')
                    });
                };

                mediaRecorder.onstart = () => {
                    console.log('MediaRecorder: Recording started, state:', mediaRecorder.state);
                };

                mediaRecorder.onstop = () => {
                    console.log(`MediaRecorder: Recording stopped. Total chunks: ${chunkCount}, Total bytes: ${totalBytesSent}`);
                };

                // Start recording with 250ms chunks for real-time streaming
                mediaRecorder.start(250);
                console.log('MediaRecorder started with 250ms chunks');

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
            // CRITICAL: Check if this message is from the current recording session
            // If isRecording is false, we've already stopped, so ignore any late messages
            if (!isRecording) {
                console.warn('Deepgram: Ignoring message from closed recording session');
                return;
            }
            
            try {
                // Deepgram sends JSON text messages (not binary)
                const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
                const data = JSON.parse(text);

                // Handle Results messages - these contain transcripts
                if (data.type === 'Results' || data.type === 'results') {
                    // Extract transcript from various possible formats
                    let newTranscript = null;
                    let isFinal = false;

                    // Format 1: data.channel.alternatives[0].transcript
            if (data.channel?.alternatives?.[0]?.transcript) {
                        newTranscript = data.channel.alternatives[0].transcript.trim();
                        isFinal = data.is_final === true;
                    }
                    // Format 2: data.results.channels[0].alternatives[0].transcript
                    else if (data.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
                        newTranscript = data.results.channels[0].alternatives[0].transcript.trim();
                        isFinal = data.results.is_final === true;
                    }
                    // Format 3: data.results.channel.alternatives[0].transcript
                    else if (data.results?.channel?.alternatives?.[0]?.transcript) {
                        newTranscript = data.results.channel.alternatives[0].transcript.trim();
                        isFinal = data.results.is_final === true;
                    }

                    if (newTranscript && newTranscript.length > 0) {
                        if (isFinal) {
                            // Final transcript - Deepgram sends the complete utterance for this phrase/sentence
                            // CRITICAL: We need to be very careful about accumulation
                            // Only append if:
                            // 1. We're still recording
                            // 2. The transcript is not empty
                            // 3. The new transcript is NOT already in the existing transcript (prevents duplicates)
                            // 4. The existing transcript is shorter than 2x the new transcript (sanity check)
                            // 5. The new transcript doesn't start with the existing transcript (prevents old data)
                            const existingTranscript = transcript.trim();
                            
                            // SIMPLIFIED LOGIC: Only append if transcript is clearly from the same session
                            // For safety, we'll be very conservative about appending
                            // Check if this looks like a continuation within the same session
                            const looksLikeContinuation = isRecording && 
                                                         existingTranscript.length > 0 && 
                                                         !newTranscript.includes(existingTranscript) &&
                                                         !existingTranscript.includes(newTranscript) &&
                                                         newTranscript.length <= existingTranscript.length * 1.5;
                            
                            if (looksLikeContinuation) {
                                // This is a continuation within the same recording session
                                transcript = existingTranscript + ' ' + newTranscript;
                                console.log('Deepgram: Appending final transcript (continuation)');
                            } else {
                                // Either fresh transcript or suspicious data - replace completely
                                // This prevents any carryover from previous sessions
                                transcript = newTranscript;
                                console.log('Deepgram: Setting fresh final transcript (replacing old) - existing was:', existingTranscript.substring(0, 50));
                            }
                            lastInterimTranscript = ''; // Clear interim since we got final
                            console.log('Deepgram: Final transcript (isRecording:', isRecording, 'transcript length:', transcript.length, '):', transcript);

                            // Send accumulated transcript update
                            chrome.runtime.sendMessage({
                                type: 'transcript-update',
                                transcript: transcript,
                                isFinal: true
                            });
                        } else {
                            // Interim result - show accumulated + current interim
                            lastInterimTranscript = newTranscript;
                            // Safety check: only use transcript if recording is still active
                            // This prevents old transcript from previous session being included
                            const displayTranscript = (isRecording && transcript.trim())
                                ? transcript + ' ' + newTranscript
                                : newTranscript;
                            console.log('Deepgram: Interim transcript (isRecording:', isRecording, 'transcript length:', transcript.length, '):', displayTranscript);

                            // Send interim transcript for real-time display
                            chrome.runtime.sendMessage({
                                type: 'transcript-update',
                                transcript: displayTranscript,
                                isFinal: false
                            });
                        }
                    }
                }
                // Handle UtteranceEnd - speech has ended (pause detected)
                else if (data.type === 'UtteranceEnd') {
                    console.log('Deepgram: Utterance ended (pause detected)');
                    // If we have an interim that wasn't finalized, add it to accumulated
                    if (lastInterimTranscript && lastInterimTranscript.trim()) {
                        if (transcript.trim()) {
                            transcript += ' ' + lastInterimTranscript;
                        } else {
                            transcript = lastInterimTranscript;
                        }
                        lastInterimTranscript = '';
                        console.log('Deepgram: Added interim to accumulated on utterance end:', transcript);

                        // Send update with accumulated transcript
                        chrome.runtime.sendMessage({
                            type: 'transcript-update',
                            transcript: transcript,
                            isFinal: true
                        });
                    }
                    // Don't send transcript-result here - wait for user to stop recording
                }
                // Handle other message types
                else if (data.type === 'Metadata') {
                    console.log('Deepgram: Metadata received');
                } else if (data.type === 'SpeechStarted') {
                    console.log('Deepgram: Speech detected');
                } else {
                    console.log('Deepgram: Other message type:', data.type);
                }
            } catch (parseError) {
                console.error('Deepgram: Failed to parse message:', parseError);
                console.error('Raw data:', event.data);
            }
        };

        deepgramSocket.onclose = (event) => {
            console.log('Offscreen: Deepgram disconnected', event.code, event.reason, 'wasClean:', event.wasClean);

            // Clean up timeout if still exists
            if (window.deepgramConnectionTimeout) {
                clearTimeout(window.deepgramConnectionTimeout);
                window.deepgramConnectionTimeout = null;
            }

            // Prevent duplicate sends - check if we already sent the result
            if (window.transcriptAlreadySent) {
                console.log('Deepgram: Transcript already sent, skipping duplicate');
                isRecording = false;
                // Clear transcript state to prevent carryover
                transcript = '';
                lastInterimTranscript = '';
                return;
            }

            // Always check if we have a transcript first, regardless of close code
            // Code 1011 can happen even when we have a valid transcript
            let finalTranscript = transcript.trim();

            // If no final transcript but we have an interim, use that
            if (!finalTranscript && lastInterimTranscript) {
                console.log('Deepgram: No final transcript, using last interim:', lastInterimTranscript);
                finalTranscript = lastInterimTranscript;
            }

            // Reset recording flag
            isRecording = false;

            if (finalTranscript) {
                // We have a transcript - send it regardless of close code
                console.log('Deepgram: Sending transcript on close:', finalTranscript);
                window.transcriptAlreadySent = true; // Mark as sent
                
                // Store transcript before clearing
                const transcriptToSend = finalTranscript;
                
                // CRITICAL: Clear transcript state IMMEDIATELY before sending to prevent any race conditions
                transcript = '';
                lastInterimTranscript = '';
                console.log('Deepgram: Transcript state cleared before sending result');
                
                // Now send the stored transcript
                chrome.runtime.sendMessage({
                    type: 'transcript-result',
                    transcript: transcriptToSend
                });
            } else {
                // No transcript - check if it's an error or just no speech detected
                const isNormalClosure = event.code === 1005 || event.code === 1000 || event.code === 1001;

                if (isNormalClosure) {
                    console.log('Deepgram: Normal closure but no transcript received (no speech detected)');
                    chrome.runtime.sendMessage({
                        type: 'transcript-result',
                        transcript: ''
                    });
                    // Clear transcript state
                    transcript = '';
                    lastInterimTranscript = '';
                } else {
                    // Unexpected closure without transcript
                    let errorMsg = 'Deepgram connection closed unexpectedly';

                    if (event.code === 1008) {
                        errorMsg = 'Deepgram authentication failed. Please check your API key in settings.';
                    } else if (event.code === 1006) {
                        errorMsg = 'Deepgram connection lost. This could be due to:\n' +
                            '1. Network connectivity issues\n' +
                            '2. Invalid API key\n' +
                            '3. Deepgram service temporarily unavailable\n\n' +
                            'Please check your API key and network connection, then try again.';
                    } else if (event.code === 1002 || event.code === 1003) {
                        errorMsg = 'Deepgram protocol error. Please verify your API key is correct.';
                    } else if (event.code === 1011) {
                        // Code 1011 with no transcript - might be timeout, but could also mean no speech
                        errorMsg = 'No speech detected or connection timeout. Please try speaking again.';
                    } else if (event.code >= 1011 && event.code <= 1015) {
                        errorMsg = 'Deepgram service error. Please try again in a moment.';
                    }

                    console.error('Deepgram close event details:', {
                        code: event.code,
                        reason: event.reason,
                        wasClean: event.wasClean,
                        hasApiKey: !!deepgramApiKey,
                        apiKeyLength: deepgramApiKey ? deepgramApiKey.length : 0,
                        transcriptLength: transcript.length,
                        transcript: finalTranscript || '(empty)'
                    });

                    chrome.runtime.sendMessage({
                        type: 'recording-error',
                        error: errorMsg
                    });
                }
                
                // Clear transcript state on error to prevent carryover
                transcript = '';
                lastInterimTranscript = '';
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
        currentDeepgramSocket = deepgramSocket;

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
        isRecording = false; // Reset flag on error
        throw error;
    }
}

/**
 * Stop recording
 */
function stopRecording() {
    console.log('Stop recording called, isRecording:', isRecording);

    // Set flag first to prevent new recordings
    isRecording = false;

    // Stop MediaRecorder first
    if (mediaRecorder) {
        console.log('MediaRecorder state before stop:', mediaRecorder.state);
        if (mediaRecorder.state !== 'inactive' && mediaRecorder.state !== 'stopped') {
            try {
        mediaRecorder.stop();
                console.log('MediaRecorder stopped');
            } catch (error) {
                console.error('Error stopping MediaRecorder:', error);
            }
    }
    mediaRecorder = null;
    }

    // Stop audio stream tracks
    if (audioStream) {
        console.log('Stopping audio stream tracks');
        try {
            audioStream.getTracks().forEach(track => {
                console.log('Stopping track:', track.kind, track.id);
                track.stop();
            });
        } catch (error) {
            console.error('Error stopping audio tracks:', error);
        }
        audioStream = null;
    }

    // Send Finalize message to flush the stream and get final transcripts
    // Per Deepgram docs: https://developers.deepgram.com/docs/finalize
    if (window.deepgramSocket) {
        const socketState = window.deepgramSocket.readyState;
        console.log('Deepgram socket state during stop:', socketState);

        if (socketState === WebSocket.OPEN) {
            try {
                console.log('Sending Finalize message to Deepgram');
                window.deepgramSocket.send(JSON.stringify({ type: 'Finalize' }));
                // Wait a moment for Deepgram to process final audio, then close
                setTimeout(() => {
                    if (window.deepgramSocket) {
                        if (window.deepgramSocket.readyState === WebSocket.OPEN || window.deepgramSocket.readyState === WebSocket.CONNECTING) {
                            console.log('Closing Deepgram socket after Finalize');
                            window.deepgramSocket.close();
                        }
                        window.deepgramSocket = null;
                    }
                }, 500);
            } catch (error) {
                console.error('Error sending Finalize message:', error);
                // If Finalize fails, just close the socket
                try {
                    if (window.deepgramSocket.readyState === WebSocket.OPEN || window.deepgramSocket.readyState === WebSocket.CONNECTING) {
                        window.deepgramSocket.close();
                    }
                } catch (closeError) {
                    console.error('Error closing socket:', closeError);
                }
                window.deepgramSocket = null;
            }
        } else {
            // Socket is not open, just clean it up
            console.log('Deepgram socket not open, cleaning up');
            try {
                if (socketState === WebSocket.CONNECTING) {
                    window.deepgramSocket.close();
                }
            } catch (error) {
                // Ignore errors if already closed
            }
            window.deepgramSocket = null;
        }
    }

    currentDeepgramSocket = null;
    
    // ALWAYS clear transcript state when stopping to prevent any carryover
    // The onclose handler will have already sent the transcript if it exists
    transcript = '';
    lastInterimTranscript = '';
    window.transcriptAlreadySent = false; // Reset flag for next recording
    console.log('Offscreen: Transcript state cleared in stopRecording');

    console.log('Recording cleanup complete');
}
