/**
 * Offscreen Document for Audio Capture
 * Simple recorder that sends full audio blob to background on stop
 */

let mediaRecorder = null;
let audioChunks = [];

// Listen for commands from background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'offscreen-start-recording-ws') {
        startRecording();
    } else if (message.type === 'offscreen-stop-recording-ws') {
        stopRecording();
    } else if (message.type === 'offscreen-cancel-recording-ws') {
        cancelRecording();
    }
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Use webm/opus which is standard for Chrome and supported by Deepgram
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // Convert chunks to single blob
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Convert to base64 for messaging
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                // Remove data URL prefix (e.g. "data:audio/webm;base64,")
                const base64data = reader.result.split(',')[1];
                
                // Send to background
                chrome.runtime.sendMessage({
                    type: 'audio_input',
                    data: base64data
                });
            };
            
            // Stop all tracks to release microphone
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        chrome.runtime.sendMessage({ type: 'recording-started' });
        console.log('Offscreen: Recording started');

    } catch (err) {
        console.error('Offscreen: Recording failed', err);
        chrome.runtime.sendMessage({ 
            type: 'recording-error', 
            error: err.message 
        });
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('Offscreen: Recording stopped');
    }
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        // Nullify handlers to prevent sending data
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
        
        // Stop streams
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
        console.log('Offscreen: Recording cancelled');
    }
}