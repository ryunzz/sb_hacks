/**
 * Vision Agent - Options Page JavaScript
 * Handles saving and loading API keys
 */

const form = document.getElementById('settingsForm');
const geminiKeyInput = document.getElementById('geminiKey');
const deepgramKeyInput = document.getElementById('deepgramKey');
const twelveLabsKeyInput = document.getElementById('twelveLabsKey');
const languageSelect = document.getElementById('language');
const voiceModelSelect = document.getElementById('voiceModel');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const config = await chrome.storage.local.get([
            'geminiApiKey',
            'deepgramApiKey',
            'twelveLabsApiKey',
            'language',
            'voiceModel'
        ]);

        geminiKeyInput.value = config.geminiApiKey || '';
        deepgramKeyInput.value = config.deepgramApiKey || '';
        twelveLabsKeyInput.value = config.twelveLabsApiKey || '';
        languageSelect.value = config.language || 'en';
        voiceModelSelect.value = config.voiceModel || 'aura-2-thalia-en';
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
            deepgramApiKey: deepgramKeyInput.value.trim(),
            twelveLabsApiKey: twelveLabsKeyInput.value.trim(),
            language: languageSelect.value,
            voiceModel: voiceModelSelect.value
        };

        // Validate Deepgram API key before saving
        if (config.deepgramApiKey && config.deepgramApiKey.trim().length < 10) {
            showStatus('Deepgram API key seems too short. Please verify it\'s correct.', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Settings';
            return;
        }

        // Save to storage
        await chrome.storage.local.set(config);

        // Verify it was saved
        const verify = await chrome.storage.local.get(['deepgramApiKey']);
        if (config.deepgramApiKey && !verify.deepgramApiKey) {
            console.error('Failed to save Deepgram API key to storage!');
            showStatus('Failed to save Deepgram API key. Please try again.', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Settings';
            return;
        }

        console.log('Settings saved. Deepgram API key length:', verify.deepgramApiKey ? verify.deepgramApiKey.length : 0);

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
