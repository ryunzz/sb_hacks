"""
Configuration management for Vision Agent backend
"""
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Config:
    """Application configuration"""

    # Gemini API
    GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
    GEMINI_MODEL = 'gemini-2.5-computer-use-preview-10-2025'

    # WebSocket Server
    WEBSOCKET_HOST = os.getenv('WEBSOCKET_HOST', 'localhost')
    WEBSOCKET_PORT = int(os.getenv('WEBSOCKET_PORT', 8000))

    # Chrome DevTools Protocol
    CHROME_CDP_PORT = int(os.getenv('CHROME_CDP_PORT', 9222))
    CHROME_CDP_URL = f'http://localhost:{CHROME_CDP_PORT}'

    # Model Configuration
    TEMPERATURE = 0.4  # Lower for more consistent actions
    MAX_OUTPUT_TOKENS = 2048

    # Viewport Configuration (recommended by Gemini)
    VIEWPORT_WIDTH = 1440
    VIEWPORT_HEIGHT = 900

    @classmethod
    def validate(cls):
        """Validate required configuration"""
        if not cls.GEMINI_API_KEY:
            raise ValueError('GEMINI_API_KEY is required in .env file')

        print(f'[Config] Gemini API Key: {"✓" if cls.GEMINI_API_KEY else "✗"}')
        print(f'[Config] WebSocket: ws://{cls.WEBSOCKET_HOST}:{cls.WEBSOCKET_PORT}')
        print(f'[Config] Chrome CDP: {cls.CHROME_CDP_URL}')
        print(f'[Config] Model: {cls.GEMINI_MODEL}')
