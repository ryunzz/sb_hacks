/**
 * Offscreen Document for Audio Capture
 * Captures audio blob and sends to background
 */

let mediaRecorder;
let audioChunks = [];

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
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64data = reader.result.split(',')[1];
                // Send full audio to background -> sidepanel -> backend
                chrome.runtime.sendMessage({
                    type: 'audio-chunk',
                    data: base64data
                });
            };
            
            // Stop tracks
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        chrome.runtime.sendMessage({ type: 'recording-started' });
    } catch (err) {
        chrome.runtime.sendMessage({ type: 'recording-error', error: err.message });
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.ondataavailable = null; // Ignore data
        mediaRecorder.onstop = null; // Don't send
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
}