/**
 * Google Generative AI SDK - Bundled for Chrome Extension
 * A minimal implementation for use in service workers
 */

export class GoogleGenerativeAI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }

    getGenerativeModel({ model, systemInstruction }) {
        return new GenerativeModel(this.apiKey, this.baseUrl, model, systemInstruction);
    }
}

class GenerativeModel {
    constructor(apiKey, baseUrl, model, systemInstruction) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.model = model;
        this.systemInstruction = systemInstruction;
    }

    async generateContent(parts) {
        const contents = [];

        // Handle array of parts (text and images)
        if (Array.isArray(parts)) {
            const contentParts = parts.map(part => {
                if (typeof part === 'string') {
                    return { text: part };
                } else if (part.inlineData) {
                    return {
                        inlineData: {
                            mimeType: part.inlineData.mimeType,
                            data: part.inlineData.data
                        }
                    };
                }
                return part;
            });
            contents.push({ role: 'user', parts: contentParts });
        } else if (typeof parts === 'string') {
            contents.push({ role: 'user', parts: [{ text: parts }] });
        }

        const requestBody = {
            contents,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
            }
        };

        if (this.systemInstruction) {
            requestBody.systemInstruction = {
                parts: [{ text: this.systemInstruction }]
            };
        }

        const response = await fetch(
            `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to generate content');
        }

        const data = await response.json();
        return new GenerateContentResponse(data);
    }

    startChat({ history = [], systemInstruction } = {}) {
        return new ChatSession(
            this.apiKey,
            this.baseUrl,
            this.model,
            history,
            systemInstruction || this.systemInstruction
        );
    }
}

class ChatSession {
    constructor(apiKey, baseUrl, model, history, systemInstruction) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.model = model;
        this.history = history;
        this.systemInstruction = systemInstruction;
    }

    async sendMessage(message) {
        const contents = [
            ...this.history,
            {
                role: 'user',
                parts: [{ text: message }]
            }
        ];

        const requestBody = {
            contents,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
            }
        };

        if (this.systemInstruction) {
            requestBody.systemInstruction = {
                parts: [{ text: this.systemInstruction }]
            };
        }

        const response = await fetch(
            `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to send message');
        }

        const data = await response.json();

        // Add assistant response to history
        if (data.candidates?.[0]?.content) {
            this.history.push({
                role: 'user',
                parts: [{ text: message }]
            });
            this.history.push(data.candidates[0].content);
        }

        return new GenerateContentResponse(data);
    }
}

class GenerateContentResponse {
    constructor(data) {
        this.data = data;
    }

    get response() {
        return {
            text: () => {
                if (!this.data.candidates || this.data.candidates.length === 0) {
                    throw new Error('No response generated');
                }
                const parts = this.data.candidates[0].content?.parts || [];
                return parts.map(p => p.text || '').join('');
            },
            candidates: this.data.candidates
        };
    }
}

export default GoogleGenerativeAI;
