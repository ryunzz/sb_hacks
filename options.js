/**
 * Vision Agent - Options Page JavaScript
 * Handles saving and loading API keys
 */

const form = document.getElementById('settingsForm');
const geminiKeyInput = document.getElementById('geminiKey');
const elevenlabsKeyInput = document.getElementById('elevenlabsKey');
const twelveLabsKeyInput = document.getElementById('twelveLabsKey');
const languageSelect = document.getElementById('language');
const voiceIdSelect = document.getElementById('voiceId');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const config = await chrome.storage.local.get([
            'geminiApiKey',
            'elevenlabsApiKey',
            'twelveLabsApiKey',
            'language',
            'voiceId'
        ]);

        geminiKeyInput.value = config.geminiApiKey || '';
        elevenlabsKeyInput.value = config.elevenlabsApiKey || '';
        twelveLabsKeyInput.value = config.twelveLabsApiKey || '';
        languageSelect.value = config.language || 'en';
        voiceIdSelect.value = config.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
});

// Save settings
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const config = {
            geminiApiKey: geminiKeyInput.value.trim(),
            elevenlabsApiKey: elevenlabsKeyInput.value.trim(),
            twelveLabsApiKey: twelveLabsKeyInput.value.trim(),
            language: languageSelect.value,
            voiceId: voiceIdSelect.value
        };

        // Validate ElevenLabs API key before saving
        if (config.elevenlabsApiKey && config.elevenlabsApiKey.trim().length < 10) {
            showStatus('ElevenLabs API key seems too short. Please verify it\'s correct.', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Settings';
            return;
        }

        // Save to storage
        await chrome.storage.local.set(config);

        // Verify it was saved
        const verify = await chrome.storage.local.get(['elevenlabsApiKey']);
        if (config.elevenlabsApiKey && !verify.elevenlabsApiKey) {
            console.error('Failed to save ElevenLabs API key to storage!');
            showStatus('Failed to save ElevenLabs API key. Please try again.', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Settings';
            return;
        }

        console.log('Settings saved. ElevenLabs API key length:', verify.elevenlabsApiKey ? verify.elevenlabsApiKey.length : 0);

        // Notify background script
        await chrome.runtime.sendMessage({
            type: 'config_updated',
            config: config
        });

        showStatus('Settings saved successfully!', 'success');
    } catch (error) {
        console.error('Failed to save settings:', error);
        showStatus('Failed to save settings. Please try again.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Settings';
    }
});

/**
 * Show status message
 */
function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;

    // Hide after 3 seconds
    setTimeout(() => {
        statusEl.className = 'status hidden';
    }, 3000);
}
