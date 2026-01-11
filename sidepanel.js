/**
 * Vision Agent - Side Panel JavaScript
 * Handles voice input (via backend), accessibility, and messages
 */

const messagesContainer = document.getElementById('messages');
const voiceBtn = document.getElementById('voiceBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const muteBtn = document.getElementById('muteBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const settingsBtn = document.getElementById('settingsBtn');

// State
let isListening = false;
let isMuted = false;
let spaceBarPressed = false; // Accessibility state

document.addEventListener('DOMContentLoaded', async () => {
    // Load simple config
    const config = await chrome.storage.local.get(['voiceMuted']);
    isMuted = config.voiceMuted || false;
    updateMuteButton();

    setupEventListeners();
    setupBackendListeners();
});

function setupBackendListeners() {
    chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
            case 'transcript_confirmed':
                // Backend heard us
                addMessage('user', message.text);
                setStatus('Agent thinking...');
                break;

            case 'narration':
                // Backend agent speaking
                addMessage('assistant', message.text);
                speak(message.text);
                break;

            case 'agent-action':
                // Optional: show action details
                // setStatus(message.description);
                break;

            case 'task_complete':
                addMessage('assistant', `✅ ${message.summary}`);
                speak(message.summary);
                setStatus('Ready');
                break;

            case 'error':
            case 'agent-error':
                addMessage('assistant', `❌ Error: ${message.message}`);
                speak("I encountered an error.");
                setStatus('Error');
                break;

            case 'recording-started':
                setStatus('Listening...');
                break;

            case 'recording-error':
                addMessage('assistant', `Mic Error: ${message.error}`);
                stopListeningUI();
                break;
                
            case 'backend-status':
                if (message.status === 'connected') setStatus('Ready');
                else setStatus('Backend Disconnected');
                break;
        }
    });
}

function setupEventListeners() {
    // Buttons
    voiceBtn.onclick = () => {
        if (isListening) stopListening();
        else startListening();
    };

    sendBtn.onclick = () => {
        const text = textInput.value.trim();
        if (text) {
            handleUserInput(text);
            textInput.value = '';
        }
    };

    textInput.onkeypress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    };

    muteBtn.onclick = toggleMute;
    
    clearChatBtn.onclick = () => {
        messagesContainer.innerHTML = '';
        setStatus('Ready');
    };
    
    settingsBtn.onclick = () => chrome.runtime.openOptionsPage();

    // Quick Actions
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const prompts = {
                describe: "Describe what's on this page.",
                summary: "Summarize this page.",
                scam: "Is this website a scam?"
            };
            if (prompts[action]) handleUserInput(prompts[action]);
        });
    });

    // Accessibility: Space bar to record
    document.onkeydown = (e) => {
        if (e.code === 'Space' && document.activeElement !== textInput && !spaceBarPressed) {
            e.preventDefault();
            spaceBarPressed = true;
            if (!isListening) startListening();
        }
        if (e.code === 'Escape' && isListening) {
            cancelRecording();
        }
    };

    document.onkeyup = (e) => {
        if (e.code === 'Space' && spaceBarPressed) {
            spaceBarPressed = false;
            // Only stop if we are listening (avoids double-stop logic)
            if (isListening) stopListening();
        }
    };
}

function startListening() {
    if (isListening) return;
    isListening = true;
    voiceBtn.classList.add('listening');
    chrome.runtime.sendMessage({ type: 'start-recording-ws' });
}

function stopListening() {
    if (!isListening) return;
    stopListeningUI();
    chrome.runtime.sendMessage({ type: 'stop-recording-ws' });
}

function cancelRecording() {
    if (!isListening) return;
    stopListeningUI();
    chrome.runtime.sendMessage({ type: 'cancel-recording-ws' });
    setStatus('Cancelled');
}

function stopListeningUI() {
    isListening = false;
    voiceBtn.classList.remove('listening');
}

function handleUserInput(text) {
    addMessage('user', text);
    setStatus('Sent...');
    chrome.runtime.sendMessage({ type: 'message', content: text });
}

function addMessage(role, content) {
    const msg = document.createElement('div');
    msg.className = `message ${role}`;
    msg.innerHTML = `<div class="message-content">${content}</div>`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setStatus(text) {
    statusEl.textContent = text;
}

function toggleMute() {
    isMuted = !isMuted;
    chrome.storage.local.set({ voiceMuted: isMuted });
    updateMuteButton();
    window.speechSynthesis.cancel();
}

function updateMuteButton() {
    muteBtn.textContent = isMuted ? '🔇 Voice Off' : '🔊 Voice On';
    muteBtn.classList.toggle('muted', isMuted);
}

async function speak(text) {
    if (isMuted || !text) return;
    
    // Stop any existing browser TTS
    window.speechSynthesis.cancel();

    // Load API key if not in memory (fast check)
    if (!deepgramApiKey) {
        const config = await chrome.storage.local.get(['deepgramApiKey']);
        deepgramApiKey = config.deepgramApiKey;
    }

    if (deepgramApiKey) {
        try {
            console.log('Generating TTS with Deepgram (Thalia)...');
            const response = await fetch(`https://api.deepgram.com/v1/speak?model=${selectedVoice}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${deepgramApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });

            if (!response.ok) throw new Error('Deepgram TTS API error');

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play();
            return; // Success
        } catch (e) {
            console.error('Deepgram TTS failed, falling back to browser:', e);
        }
    }

    // Fallback to browser TTS
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
}