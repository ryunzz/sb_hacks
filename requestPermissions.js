/**
 * Request Microphone Permissions
 * This page must be opened in a regular tab (not sidepanel) to request permissions
 * Based on: https://github.com/justinmann/sidepanel-audio-issue
 */

const requestBtn = document.getElementById('requestBtn');
const status = document.getElementById('status');
const openSettingsBtn = document.getElementById('openSettingsBtn');

// Check if we're in the right context
if (window.location.protocol === 'chrome-extension:') {
    // We're in an extension page, which is correct
    console.log('Extension page context detected');
} else {
    console.warn('Not in extension context - permissions may not work correctly');
}

/**
 * Request microphone permission
 */
async function requestMicrophonePermission() {
    requestBtn.disabled = true;
    status.className = 'status';
    status.style.display = 'none';
    
    try {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('getUserMedia is not available in this context');
        }

        console.log('Requesting microphone access...');
        
        // Request microphone access
        // This will trigger Chrome's permission prompt
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Success! Stop the stream immediately (we just needed permission)
        stream.getTracks().forEach(track => track.stop());
        
        status.textContent = '✅ Microphone permission granted! You can now use voice input in the extension.';
        status.className = 'status success';
        status.style.display = 'block';
        
        // Notify the extension that permission was granted
        try {
            chrome.runtime.sendMessage({ 
                type: 'microphone-permission-granted' 
            });
        } catch (e) {
            console.log('Could not send message to extension:', e);
        }
        
        // Close this tab after a delay
        setTimeout(() => {
            window.close();
        }, 2000);
        
    } catch (error) {
        console.error('Permission error:', error);
        
        let errorMessage = '❌ Permission denied. ';
        
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Please allow microphone access when prompted, or enable it manually in Chrome settings.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No microphone found. Please connect a microphone and try again.';
        } else if (error.name === 'NotReadableError') {
            errorMessage += 'Microphone is being used by another application.';
        } else {
            errorMessage += `Error: ${error.message}`;
        }
        
        status.textContent = errorMessage;
        status.className = 'status error';
        status.style.display = 'block';
        requestBtn.disabled = false;
    }
}

/**
 * Open Chrome microphone settings
 */
function openMicrophoneSettings() {
    chrome.tabs.create({ 
        url: 'chrome://settings/content/microphone',
        active: true
    });
}

// Event listeners
requestBtn.addEventListener('click', requestMicrophonePermission);
openSettingsBtn.addEventListener('click', openMicrophoneSettings);

// Auto-request on page load (since user already clicked to get here)
window.addEventListener('load', () => {
    // Small delay to ensure page is fully loaded
    setTimeout(() => {
        requestMicrophonePermission();
    }, 500);
});

