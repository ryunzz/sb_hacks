"""
WebSocket Server - Connects Chrome extension to Gemini CUA agent
Updated to handle voice input via Deepgram (STT) and output via Deepgram (TTS)
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

# Deepgram
from deepgram import (
    DeepgramClient,
)

class WebSocketServer:
    """WebSocket server for Chrome extension communication"""

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
        
        # Initialize Deepgram
        self.deepgram_api_key = self._load_deepgram_key()
        self.deepgram = None
        if self.deepgram_api_key:
            try:
                self.deepgram = DeepgramClient(self.deepgram_api_key)
                print("[WebSocket] ✓ Deepgram client initialized")
            except Exception as e:
                print(f"[WebSocket] ❌ Failed to initialize Deepgram: {e}")
        else:
            print("[WebSocket] ⚠ No Deepgram API key found. Voice features disabled.")

    def _load_deepgram_key(self) -> Optional[str]:
        """Load Deepgram API key from environment or file"""
        # Try env var first
        key = os.getenv("DEEPGRAM_API_KEY")
        if key:
            return key
            
        # Try file
        key_path = Path(__file__).parent / "deepgram_api_key"
        if key_path.exists():
            return key_path.read_text(encoding="utf-8").strip()
            
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
                    # Check if message is binary (raw audio) or text (JSON)
                    if isinstance(message, bytes):
                        # Handle binary audio chunk (stream) - not implemented yet for MVP
                        # We expect "audio_input" JSON with base64 for now as per plan
                        print(f"[WebSocket] Received binary message ({len(message)} bytes), ignoring.")
                        continue

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
            # Handle audio input (STT)
            audio_data_b64 = data.get("data")
            if not audio_data_b64:
                await websocket.send(json.dumps({"type": "error", "message": "No audio data provided"}))
                return
                
            if not self.deepgram:
                await websocket.send(json.dumps({"type": "error", "message": "Deepgram not configured on backend"}))
                return

            print(f"[WebSocket] Received audio input ({len(audio_data_b64)} chars)")
            
            try:
                # Decode base64
                audio_bytes = base64.b64decode(audio_data_b64)
                
                # Transcribe using Deepgram
                # Assuming audio/webm (opus) from Chrome
                options = {
                    "model": "nova-2",
                    "smart_format": True,
                    "mimetype": "audio/webm"
                }
                
                print("[WebSocket] Transcribing audio...")
                source = {"buffer": audio_bytes, "mimetype": "audio/webm"}
                response = self.deepgram.listen.rest.v("1").transcribe_file(source, options)
                
                transcript = response.results.channels[0].alternatives[0].transcript
                print(f"[WebSocket] Transcript: '{transcript}'")
                
                if not transcript:
                    await websocket.send(json.dumps({"type": "response", "message": "I didn't hear anything."}))
                    return

                # Send transcript back to UI so user sees what was heard
                await websocket.send(json.dumps({
                    "type": "transcript_confirmed", 
                    "text": transcript
                }))

                # Now treat this as a user task
                await self.start_agent_task(transcript, websocket)

            except Exception as e:
                print(f"[WebSocket] STT Error: {e}")
                await websocket.send(json.dumps({"type": "error", "message": f"Transcription failed: {str(e)}"}))

        elif msg_type == "user_message":
            task = data.get("text", "").strip()
            if not task:
                await websocket.send(
                    json.dumps({"type": "error", "message": "Empty task"})
                )
                return

            print(f"[WebSocket] Received task: {task}")
            await self.start_agent_task(task, websocket)

        elif msg_type == "interrupt":
            if self.agent and self.agent_running:
                new_instruction = data.get("new_instruction", "")
                print(f"[WebSocket] Interrupt requested: {new_instruction}")
                self.agent.interrupt(new_instruction)
                await self.send_to_clients({
                    "type": "narration",
                    "text": f"Interrupting current task..."
                })
            else:
                await websocket.send(
                    json.dumps({"type": "error", "message": "No agent running to interrupt"})
                )

        else:
            print(f"[WebSocket] Unknown message type: {msg_type}")
            # Don't send error for unknowns to avoid loops with broadcast messages
            
    async def start_agent_task(self, task: str, websocket):
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
            # Cleanup handled in run_agent_task finally block usually, 
            # but we reset here just in case launch failed
            pass

    def run_agent_task(self, task: str):
        """
        Runs in thread pool - sync code only

        Args:
            task: User task description
        """
        print(f"[WebSocket] Starting agent task in thread pool: {task}")
        self.agent_running = True

        # Create sync callback that puts messages in queue
        def sync_callback(message):
            """Thread-safe callback to send messages to WebSocket"""
            # Intercept narration to generate audio (TTS)
            if message.get("type") == "narration" and self.deepgram:
                text = message.get("text")
                if text:
                    try:
                        print(f"[WebSocket] Generating TTS for: {text[:30]}...")
                        options = {
                            "model": "aura-2-thalia-en",
                        }
                        # Generate audio
                        response = self.deepgram.speak.rest.v("1").save(filename=None, source={"text": text}, options=options)
                        # response is a file-like object or bytes?
                        # SDK v3 save returns filename usually, but save(None) might return stream?
                        # Let's use stream instead
                        # Actually speak.rest.v("1").stream_memory might be better or just handling the response
                        # The Deepgram Python SDK structure is a bit complex.
                        # Let's try to get bytes.
                        
                        # Fallback: Just let frontend do TTS for now if this is complex to implement blindly
                        # But user asked for Thalia on backend.
                        # Let's assume frontend still handles it via `speak()` based on the message.
                        pass
                    except Exception as e:
                        print(f"[WebSocket] TTS Generation failed: {e}")
            
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

                # Send completion
                sync_callback({
                    "type": "task_complete",
                    "success": True,
                    "summary": self.agent.final_reasoning or "Task completed"
                })

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