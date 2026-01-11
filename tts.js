let currentAudioQueue = [];
let isPlayingAudio = false;

// Helper function to chunk text for TTS APIs that have character limits
function chunkText(text, maxLength = 1900) {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        let chunk = remaining.substring(0, maxLength);
        const lastPeriod = chunk.lastIndexOf('.');
        const lastExclamation = chunk.lastIndexOf('!');
        const lastQuestion = chunk.lastIndexOf('?');
        const lastNewline = chunk.lastIndexOf('\n');
        
        let breakPoint = Math.max(lastPeriod, lastExclamation, lastQuestion, lastNewline);
        
        if (breakPoint > maxLength - 200 && breakPoint > 0) {
            chunk = remaining.substring(0, breakPoint + 1).trim();
            remaining = remaining.substring(breakPoint + 1).trim();
        } else {
            chunk = remaining.substring(0, maxLength).trim();
            remaining = remaining.substring(maxLength).trim();
        }

        if (chunk.length > 0) {
            chunks.push(chunk);
        }
    }

    return chunks;
}

// Speak with ElevenLabs
async function speakElevenLabs(text, apiKey, voiceId) {
    if (!apiKey) {
        console.warn('No ElevenLabs API key for TTS');
        return;
    }

    const chunks = chunkText(text.trim(), 1900);
    console.log(`TTS (ElevenLabs): Splitting text into ${chunks.length} chunk(s)`);

    for (const chunk of chunks) {
        await speakElevenLabsChunk(chunk, apiKey, voiceId);
    }
}

async function speakElevenLabsChunk(chunk, apiKey, voiceId) {
    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: chunk,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.5
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('ElevenLabs TTS API error:', response.status, errorText);
            return;
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        currentAudioQueue.push(audio);

        await new Promise((resolve, reject) => {
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                isPlayingAudio = currentAudioQueue.length > 0;
                resolve();
            };

            audio.onerror = (error) => {
                console.error('Audio playback error:', error);
                URL.revokeObjectURL(audioUrl);
                currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                isPlayingAudio = currentAudioQueue.length > 0;
                reject(error);
            };

            isPlayingAudio = true;
            audio.play().catch(reject);
        });
    } catch (error) {
        console.error('ElevenLabs TTS chunk error:', error);
    }
}

// Speak with Deepgram
async function speakDeepgram(text, apiKey, voiceId) {
    if (!apiKey) {
        console.warn('No Deepgram API key for TTS');
        return;
    }

    try {
        const response = await fetch(
            'https://api.deepgram.com/v1/speak?model=aura-asteria-en',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text
                })
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Deepgram TTS API error:', response.status, errorText);
            return;
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        currentAudioQueue.push(audio);

        await new Promise((resolve, reject) => {
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                isPlayingAudio = currentAudioQueue.length > 0;
                resolve();
            };

            audio.onerror = (error) => {
                console.error('Audio playback error:', error);
                URL.revokeObjectURL(audioUrl);
                currentAudioQueue = currentAudioQueue.filter(a => a !== audio);
                isPlayingAudio = currentAudioQueue.length > 0;
                reject(error);
            };

            isPlayingAudio = true;
            audio.play().catch(reject);
        });

    } catch (error) {
        console.error('Deepgram TTS error:', error);
    }
}


// Main speak function
export async function speak(text, ttsProvider, elevenlabsApiKey, deepgramApiKey, voiceId) {
    if (!text.trim()) return;

    stopAllAudio();

    if (ttsProvider === 'elevenlabs') {
        await speakElevenLabs(text, elevenlabsApiKey, voiceId);
    } else if (ttsProvider === 'deepgram') {
        await speakDeepgram(text, deepgramApiKey, voiceId);
    } else {
        console.warn(`Unknown TTS provider: ${ttsProvider}`);
    }
}

// Stop all audio
export function stopAllAudio() {
    currentAudioQueue.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
    });
    currentAudioQueue = [];
    isPlayingAudio = false;
}
