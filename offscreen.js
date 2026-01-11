/**
 * Offscreen Document for Audio Capture
 * Records audio as WebM (Opus) and sends to backend via background.js
 * 
 * Audio Format: audio/webm with Opus codec
 * - This is the default format from MediaRecorder
 * - Deepgram Nova-2 supports this natively
 */

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let isRecording = false;

console.log('[Offscreen] Document loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only handle offscreen-prefixed messages
    if (!message.type || !message.type.startsWith('offscreen-')) {
        return false;
    }
    
    console.log('[Offscreen] Received:', message.type);
    
    switch (message.type) {
        case 'offscreen-start-recording-ws':
            startRecording()
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Async response
            
        case 'offscreen-stop-recording-ws':
            stopRecording();
            sendResponse({ success: true });
            return true;
            
        case 'offscreen-cancel-recording-ws':
            cancelRecording();
            sendResponse({ success: true });
            return true;
    }
    
    return false;
});

/**
 * Start recording audio from microphone
 * Captures as audio/webm (Opus codec)
 */
async function startRecording() {
    if (isRecording) {
        console.warn('[Offscreen] Already recording');
        return;
    }
    
    // Reset state
    audioChunks = [];
    isRecording = true;
    
    try {
        // Request microphone access
        console.log('[Offscreen] Requesting microphone...');
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: { ideal: 48000 }
            }
        });
        
        console.log('[Offscreen] Microphone access granted');
        
        // Find supported MIME type
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus'
        ];
        
        let selectedMime = '';
        for (const mime of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mime)) {
                selectedMime = mime;
                break;
            }
        }
        
        console.log('[Offscreen] Using MIME type:', selectedMime || 'default');
        
        // Create MediaRecorder
        const options = selectedMime ? { mimeType: selectedMime } : {};
        mediaRecorder = new MediaRecorder(audioStream, options);
        
        // Collect audio chunks
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
                console.log(`[Offscreen] Chunk received: ${event.data.size} bytes`);
            }
        };
        
        // Handle recording stop
        mediaRecorder.onstop = async () => {
            console.log('[Offscreen] MediaRecorder stopped, processing audio...');
            
            if (audioChunks.length === 0) {
                console.warn('[Offscreen] No audio chunks recorded');
                chrome.runtime.sendMessage({ type: 'recording-error', error: 'No audio recorded' });
                cleanup();
                return;
            }
            
            try {
                // Combine chunks into single blob
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                console.log(`[Offscreen] Audio blob: ${audioBlob.size} bytes`);
                
                // Convert to base64
                const arrayBuffer = await audioBlob.arrayBuffer();
                const base64 = btoa(
                    new Uint8Array(arrayBuffer)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );
                
                console.log(`[Offscreen] Sending ${base64.length} chars base64 to backend`);
                
                // Send to background.js -> backend for STT
                chrome.runtime.sendMessage({
                    type: 'audio-chunk',
                    data: base64
                });
                
            } catch (error) {
                console.error('[Offscreen] Error processing audio:', error);
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: 'Failed to process audio: ' + error.message
                });
            }
            
            cleanup();
        };
        
        mediaRecorder.onerror = (event) => {
            console.error('[Offscreen] MediaRecorder error:', event.error);
            chrome.runtime.sendMessage({
                type: 'recording-error',
                error: 'Recording error: ' + (event.error?.message || 'Unknown')
            });
            cleanup();
        };
        
        // Start recording
        mediaRecorder.start();
        console.log('[Offscreen] Recording started');
        
        // Notify UI
        chrome.runtime.sendMessage({ type: 'recording-started' });
        
    } catch (error) {
        console.error('[Offscreen] Failed to start recording:', error);
        isRecording = false;
        
        let errorMsg = 'Microphone access failed';
        if (error.name === 'NotAllowedError') {
            errorMsg = 'Microphone permission denied. Please allow microphone access.';
        } else if (error.name === 'NotFoundError') {
            errorMsg = 'No microphone found. Please connect a microphone.';
        } else if (error.name === 'NotReadableError') {
            errorMsg = 'Microphone is in use by another application.';
        }
        
        chrome.runtime.sendMessage({
            type: 'recording-error',
            error: errorMsg
        });
        
        throw error;
    }
}

/**
 * Stop recording and send audio to backend
 */
function stopRecording() {
    if (!isRecording || !mediaRecorder) {
        console.warn('[Offscreen] Not recording');
        return;
    }
    
    console.log('[Offscreen] Stopping recording...');
    isRecording = false;
    
    if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

/**
 * Cancel recording without sending audio
 */
function cancelRecording() {
    if (!isRecording) {
        return;
    }
    
    console.log('[Offscreen] Cancelling recording...');
    isRecording = false;
    audioChunks = []; // Discard audio
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        // Remove onstop handler to prevent sending
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
    }
    
    cleanup();
    
    chrome.runtime.sendMessage({ type: 'recording-cancelled' });
}

/**
 * Cleanup resources
 */
function cleanup() {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    mediaRecorder = null;
    audioChunks = [];
    isRecording = false;
}
