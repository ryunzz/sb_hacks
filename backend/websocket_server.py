"""
WebSocket Server - Connects Chrome extension to Gemini CUA agent
Handles voice input via Deepgram (STT) and output via Deepgram (TTS)

Audio Format Requirements:
  - STT Input: audio/webm (opus codec) - captured by browser MediaRecorder
  - TTS Output: audio/mp3 - sent as base64 to frontend for playback
"""

import asyncio
import websockets
import json
import queue
import base64
import os
from typing import Set, Optional
from concurrent.futures import ThreadPoolExecutor
from websockets.server import WebSocketServerProtocol
from pathlib import Path

from gemini_cua_agent import BrowserAgent
from computers.playwright_cdp_computer import PlaywrightCDPComputer

# Deepgram SDK
from deepgram import DeepgramClient

# Available Deepgram Aura-2 TTS voices (English)
DEEPGRAM_VOICES = {
    "aura-2-thalia-en": "Thalia - Warm, Conversational",
    "aura-2-andromeda-en": "Andromeda - Professional",
    "aura-2-arcas-en": "Arcas - Confident",
    "aura-2-asteria-en": "Asteria - Clear, Expressive",
    "aura-2-athena-en": "Athena - Authoritative",
    "aura-2-helios-en": "Helios - Deep, Resonant",
    "aura-2-hera-en": "Hera - Warm, Nurturing",
    "aura-2-luna-en": "Luna - Soft, Soothing",
    "aura-2-orion-en": "Orion - Strong, Clear",
    "aura-2-perseus-en": "Perseus - Articulate",
    "aura-2-stella-en": "Stella - Friendly",
    "aura-2-zeus-en": "Zeus - Commanding",
}
DEFAULT_VOICE = "aura-2-thalia-en"


class WebSocketServer:
    """WebSocket server for Chrome extension communication with Deepgram voice support"""

    def __init__(self, host="localhost", port=8000):
        """
        Initialize WebSocket server

        Args:
            host: Server host (default: localhost)
            port: Server port (default: 8000)
        """
        self.host = host
        self.port = port
        self.clients: Set[WebSocketServerProtocol] = set()
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.message_queue = queue.Queue()
        self.agent = None
        self.agent_running = False
        
        # Voice settings (can be updated by client)
        self.selected_voice = DEFAULT_VOICE
        
        # Initialize Deepgram
        self.deepgram_api_key = self._load_deepgram_key()
        self.deepgram = None
        if self.deepgram_api_key:
            try:
                self.deepgram = DeepgramClient(self.deepgram_api_key)
                print("[WebSocket] ✓ Deepgram client initialized")
                print(f"[WebSocket]   Default voice: {DEFAULT_VOICE} ({DEEPGRAM_VOICES[DEFAULT_VOICE]})")
            except Exception as e:
                print(f"[WebSocket] ❌ Failed to initialize Deepgram: {e}")
        else:
            print("[WebSocket] ⚠ No Deepgram API key found. Voice features disabled.")
            print("[WebSocket]   Create 'deepgram_api_key' file in backend/ directory")

    def _load_deepgram_key(self) -> Optional[str]:
        """Load Deepgram API key from environment or file"""
        # Try env var first
        key = os.getenv("DEEPGRAM_API_KEY")
        if key:
            print("[WebSocket] Loaded Deepgram API key from environment")
            return key.strip()
            
        # Try file
        key_path = Path(__file__).parent / "deepgram_api_key"
        if key_path.exists():
            key = key_path.read_text(encoding="utf-8").strip()
            if key and not key.startswith("#"):
                print("[WebSocket] Loaded Deepgram API key from file")
                return key
            
        return None

    def transcribe_audio(self, audio_bytes: bytes) -> Optional[str]:
        """
        Transcribe audio using Deepgram Nova-2
        
        Args:
            audio_bytes: Audio data (webm/opus format from browser)
            
        Returns:
            Transcript text, or None if failed
        """
        if not self.deepgram:
            print("[STT] Deepgram not initialized")
            return None
            
        try:
            print(f"[STT] Transcribing {len(audio_bytes)} bytes of audio...")
            
            # Configure transcription options
            options = {
                "model": "nova-2",
                "smart_format": True,
                "language": "en",
                "punctuate": True,
            }
            
            # Transcribe - audio/webm is auto-detected by Deepgram
            source = {"buffer": audio_bytes, "mimetype": "audio/webm"}
            response = self.deepgram.listen.rest.v("1").transcribe_file(source, options)
            
            # Extract transcript
            transcript = response.results.channels[0].alternatives[0].transcript
            print(f"[STT] Transcript: '{transcript}'")
            return transcript
            
        except Exception as e:
            print(f"[STT] Error transcribing audio: {e}")
            import traceback
            traceback.print_exc()
            return None

    def generate_tts_audio(self, text: str, voice: Optional[str] = None) -> Optional[str]:
        """
        Generate TTS audio using Deepgram Aura-2
        
        Args:
            text: Text to convert to speech
            voice: Voice model to use (defaults to selected_voice)
            
        Returns:
            Base64 encoded MP3 audio, or None if failed
        """
        if not self.deepgram or not text:
            return None
            
        voice = voice or self.selected_voice
        if voice not in DEEPGRAM_VOICES:
            voice = DEFAULT_VOICE
            
        try:
            print(f"[TTS] Generating audio with voice '{voice}' for: {text[:50]}...")
            
            # Use Deepgram TTS API - stream to memory
            options = {"model": voice}
            response = self.deepgram.speak.rest.v("1").stream_memory(
                source={"text": text},
                options=options
            )
            
            # Get audio bytes from response
            audio_bytes = response.stream_memory.getvalue()
            
            if audio_bytes:
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                print(f"[TTS] Generated {len(audio_bytes)} bytes of audio")
                return audio_b64
            else:
                print("[TTS] No audio data received")
                return None
                
        except Exception as e:
            print(f"[TTS] Error generating audio: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def handler(self, websocket: WebSocketServerProtocol):
        """
        Handle WebSocket connection from Chrome extension

        Args:
            websocket: WebSocket connection
        """
        self.clients.add(websocket)
        remote_addr = websocket.remote_address
        print(f"[WebSocket] Client connected from {remote_addr}. Total clients: {len(self.clients)}")

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    await self.handle_message(data, websocket)
                except json.JSONDecodeError as e:
                    print(f"[WebSocket] Invalid JSON: {e}")
                    await websocket.send(
                        json.dumps({"type": "error", "message": "Invalid JSON format"})
                    )
                except Exception as e:
                    print(f"[WebSocket] Error handling message: {e}")
                    import traceback
                    traceback.print_exc()
                    await websocket.send(
                        json.dumps({"type": "error", "message": str(e)})
                    )

        except websockets.exceptions.ConnectionClosed:
            print(f"[WebSocket] Client {remote_addr} disconnected")
        finally:
            self.clients.remove(websocket)
            print(f"[WebSocket] Remaining clients: {len(self.clients)}")

    async def handle_message(self, data: dict, websocket: WebSocketServerProtocol):
        """
        Route messages from Chrome extension

        Args:
            data: Parsed JSON message
            websocket: WebSocket connection that sent the message
        """
        msg_type = data.get("type")

        if msg_type == "audio_input":
            # Handle base64-encoded audio input (STT)
            audio_data_b64 = data.get("data")
            if not audio_data_b64:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "No audio data provided"
                }))
                return
                
            if not self.deepgram:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "Deepgram not configured. Add deepgram_api_key file to backend/"
                }))
                return

            print(f"[WebSocket] Received audio input ({len(audio_data_b64)} chars base64)")
            
            try:
                # Decode base64 audio
                audio_bytes = base64.b64decode(audio_data_b64)
                print(f"[WebSocket] Decoded to {len(audio_bytes)} bytes")
                
                # Transcribe using Deepgram
                transcript = self.transcribe_audio(audio_bytes)
                
                if not transcript:
                    await websocket.send(json.dumps({
                        "type": "transcript_result",
                        "text": "",
                        "message": "No speech detected. Please try again."
                    }))
                    return

                # Send transcript confirmation back to UI
                await websocket.send(json.dumps({
                    "type": "transcript_confirmed",
                    "text": transcript
                }))

                # Start agent task with the transcript
                await self.start_agent_task(transcript, websocket)

            except Exception as e:
                print(f"[WebSocket] STT Error: {e}")
                import traceback
                traceback.print_exc()
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Transcription failed: {str(e)}"
                }))

        elif msg_type == "user_message":
            task = data.get("text", "").strip()
            if not task:
                await websocket.send(
                    json.dumps({"type": "error", "message": "Empty task"})
                )
                return

            print(f"[WebSocket] Received task: {task}")
            await self.start_agent_task(task, websocket)

        elif msg_type == "set_voice":
            # Update voice preference
            voice = data.get("voice", DEFAULT_VOICE)
            if voice in DEEPGRAM_VOICES:
                self.selected_voice = voice
                print(f"[WebSocket] Voice set to: {voice} ({DEEPGRAM_VOICES[voice]})")
                await websocket.send(json.dumps({
                    "type": "voice_updated",
                    "voice": voice,
                    "name": DEEPGRAM_VOICES[voice]
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Unknown voice: {voice}"
                }))

        elif msg_type == "get_voices":
            # Return available voices
            await websocket.send(json.dumps({
                "type": "voices_list",
                "voices": DEEPGRAM_VOICES,
                "current": self.selected_voice,
                "default": DEFAULT_VOICE
            }))

        elif msg_type == "interrupt":
            if self.agent and self.agent_running:
                new_instruction = data.get("new_instruction", "")
                print(f"[WebSocket] Interrupt requested: {new_instruction}")
                self.agent.interrupt(new_instruction)
                await self.send_to_clients({
                    "type": "narration",
                    "text": "Interrupting current task..."
                })
            else:
                await websocket.send(
                    json.dumps({
                        "type": "error",
                        "message": "No agent running to interrupt"
                    })
                )

        else:
            print(f"[WebSocket] Unknown message type: {msg_type}")
            # Don't send error for unknown types to avoid loops with broadcasts

    async def start_agent_task(self, task: str, websocket: WebSocketServerProtocol):
        """Helper to start agent task"""
        # Check if agent is already running
        if self.agent_running:
            print("[WebSocket] Agent is already running")
            await websocket.send(
                json.dumps({
                    "type": "error",
                    "message": "Agent is already running a task. Please wait or send an interrupt."
                })
            )
            return

        try:
            # Start message queue processor
            asyncio.create_task(self.process_message_queue())

            # Run sync agent in executor
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                self.executor,
                self.run_agent_task,
                task
            )
        except Exception as e:
            print(f"[WebSocket] ❌ Agent error: {e}")
            import traceback
            traceback.print_exc()
            await self.send_to_clients({
                "type": "error",
                "message": f"Agent error: {str(e)}"
            })
        finally:
            self.agent_running = False
            self.agent = None

    def run_agent_task(self, task: str):
        """
        Runs in thread pool - sync code only

        Args:
            task: User task description
        """
        print(f"[WebSocket] Starting agent task in thread pool: {task}")
        self.agent_running = True

        # Create sync callback that puts messages in queue with TTS
        def sync_callback(message):
            """Thread-safe callback to send messages to WebSocket with TTS audio"""
            # Generate TTS for narrations
            if message.get("type") == "narration" and self.deepgram:
                text = message.get("text")
                if text:
                    audio_b64 = self.generate_tts_audio(text)
                    if audio_b64:
                        message["audio"] = audio_b64
                        message["audio_format"] = "audio/mp3"
            
            self.message_queue.put(message)

        try:
            # Create CDP computer with context manager
            # This connects to user's existing Chrome with extension loaded!
            # Enable mouse highlighting so user sees interactions
            with PlaywrightCDPComputer(highlight_mouse=True) as computer:
                print("[WebSocket] ✓ Connected to Chrome via CDP")

                # Create sync BrowserAgent
                self.agent = BrowserAgent(
                    browser_computer=computer,
                    query=task,
                    send_callback=sync_callback,
                    max_turns=100,
                )

                # Run agent loop (blocking, synchronous)
                self.agent.agent_loop()

                # Send completion with TTS
                completion_msg = {
                    "type": "task_complete",
                    "success": True,
                    "summary": self.agent.final_reasoning or "Task completed"
                }
                
                # Generate TTS for completion
                if self.deepgram:
                    audio_b64 = self.generate_tts_audio(completion_msg["summary"])
                    if audio_b64:
                        completion_msg["audio"] = audio_b64
                        completion_msg["audio_format"] = "audio/mp3"
                
                sync_callback(completion_msg)

        except Exception as e:
            print(f"[WebSocket] ❌ Error running agent: {e}")
            import traceback
            traceback.print_exc()
            sync_callback({
                "type": "error",
                "message": f"Agent error: {str(e)}"
            })
        finally:
            self.agent_running = False
            print("[WebSocket] Agent task completed")

    async def process_message_queue(self):
        """Send queued messages from agent thread to WebSocket clients"""
        print("[WebSocket] Message queue processor started")
        while self.agent_running or not self.message_queue.empty():
            try:
                # Non-blocking get
                message = self.message_queue.get_nowait()
                await self.send_to_clients(message)
            except queue.Empty:
                # No messages, sleep briefly
                await asyncio.sleep(0.1)
        print("[WebSocket] Message queue processor stopped")

    async def send_to_clients(self, message: dict):
        """
        Broadcast message to all connected clients

        Args:
            message: Dictionary to send as JSON

        Note:
            This is called by the queue processor to forward agent messages
        """
        if not self.clients:
            return

        message_json = json.dumps(message)

        # Send to all connected clients
        await asyncio.gather(
            *[client.send(message_json) for client in self.clients],
            return_exceptions=True
        )

    async def start(self):
        """Start WebSocket server"""
        print(f"[WebSocket] Starting server on ws://{self.host}:{self.port}")
        print(f"[WebSocket] Chrome extension should connect to this address")
        print(f"[WebSocket] Press Ctrl+C to stop\n")

        async with websockets.serve(self.handler, self.host, self.port):
            print(f"[WebSocket] ✓ Server running on ws://{self.host}:{self.port}\n")
            await asyncio.Future()  # Run forever


async def main():
    """Main entry point"""
    print("=" * 60)
    print("Gemini Computer Use Agent - WebSocket Server")
    print("=" * 60)
    print()
    
    print("Voice API Configuration:")
    print(f"  Default TTS Voice: {DEFAULT_VOICE}")
    print(f"  Available Voices: {len(DEEPGRAM_VOICES)}")
    print()
    
    print("Audio Format Requirements:")
    print("  STT Input:  audio/webm (opus) - from browser MediaRecorder")
    print("  TTS Output: audio/mp3 - sent as base64 to frontend")
    print()

    # Check if Chrome remote debugging instructions should be displayed
    print("IMPORTANT: Before running tasks, make sure:")
    print("1. Chrome is running with remote debugging enabled:")
    print(r"   macOS: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222")
    print("   Linux: google-chrome --remote-debugging-port=9222 &")
    print("   Windows: \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --remote-debugging-port=9222")
    print()
    print("2. Verify Chrome is running: http://127.0.0.1:9222/json")
    print("   (Use 127.0.0.1, not localhost, to avoid IPv6 issues)")
    print()
    print("3. Chrome extension is loaded and connected")
    print()

    server = WebSocketServer()

    try:
        await server.start()
    except KeyboardInterrupt:
        print("\n[WebSocket] Shutting down...")
    finally:
        # Cleanup
        server.executor.shutdown(wait=True)
        print("[WebSocket] Server stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
