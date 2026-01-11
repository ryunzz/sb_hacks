"""
WebSocket Server
Real-time bidirectional communication with Chrome Extension
"""
import asyncio
import json
import websockets
from websockets.server import WebSocketServerProtocol
from typing import Set
from config import Config


class WebSocketServer:
    """WebSocket server for Extension ↔ Backend communication"""

    def __init__(self, host: str, port: int):
        """
        Initialize WebSocket server

        Args:
            host: Server host (default: localhost)
            port: Server port (default: 8000)
        """
        self.host = host
        self.port = port
        self.agent = None  # Will be set by main.py
        self.active_connections: Set[WebSocketServerProtocol] = set()

        print(f'[WebSocket] Server configured at ws://{host}:{port}')

    async def start(self):
        """Start WebSocket server"""
        print(f'[WebSocket] Starting server on ws://{self.host}:{self.port}')

        async with websockets.serve(
            self.handle_connection,
            self.host,
            self.port
        ):
            print(f'[WebSocket] ✓ Server running')
            await asyncio.Future()  # Run forever

    async def handle_connection(self, websocket: WebSocketServerProtocol):
        """
        Handle incoming WebSocket connection

        Args:
            websocket: WebSocket connection
        """
        # Add to active connections
        self.active_connections.add(websocket)
        client_id = id(websocket)

        print(f'[WebSocket] Client {client_id} connected')

        try:
            # Listen for messages from this client
            async for message in websocket:
                await self.handle_message(websocket, message)

        except websockets.exceptions.ConnectionClosed:
            print(f'[WebSocket] Client {client_id} disconnected')

        finally:
            # Remove from active connections
            self.active_connections.remove(websocket)

    async def handle_message(self, websocket: WebSocketServerProtocol, message: str):
        """
        Route incoming messages

        Args:
            websocket: WebSocket connection
            message: JSON message string
        """
        try:
            data = json.loads(message)
            msg_type = data.get('type')

            print(f'[WebSocket] Received: {msg_type}')

            if msg_type == 'user_message':
                # User sent a command (voice or text)
                await self._handle_user_message(data)

            elif msg_type == 'interrupt':
                # User interrupted ongoing task
                await self._handle_interruption(data)

            elif msg_type == 'status':
                # Client requested agent status
                await self._handle_status_request(websocket)

            else:
                print(f'[WebSocket] Unknown message type: {msg_type}')

        except json.JSONDecodeError as error:
            print(f'[WebSocket] JSON decode error: {error}')

        except Exception as error:
            print(f'[WebSocket] Message handling error: {error}')
            await self.send_error(str(error))

    async def _handle_user_message(self, data: dict):
        """Handle user message (start new task)"""
        try:
            user_text = data.get('text', '')
            print(f'[WebSocket] User message: {user_text}')

            if not self.agent:
                await self.send_error('Agent not initialized')
                return

            # Start task in background (don't block WebSocket)
            asyncio.create_task(
                self.agent.execute_task(
                    user_goal=user_text,
                    narration_callback=self._narration_callback
                )
            )

        except Exception as error:
            print(f'[WebSocket] Error handling user message: {error}')
            await self.send_error(str(error))

    async def _handle_interruption(self, data: dict):
        """Handle user interruption"""
        try:
            new_instruction = data.get('new_instruction', '')
            print(f'[WebSocket] Interruption: {new_instruction}')

            if not self.agent:
                await self.send_error('Agent not initialized')
                return

            # Handle interruption
            asyncio.create_task(
                self.agent.handle_interruption(
                    new_instruction=new_instruction,
                    narration_callback=self._narration_callback
                )
            )

        except Exception as error:
            print(f'[WebSocket] Error handling interruption: {error}')
            await self.send_error(str(error))

    async def _handle_status_request(self, websocket: WebSocketServerProtocol):
        """Handle status request"""
        try:
            state = 'idle'
            current_task = None

            if self.agent and self.agent.current_task:
                state = 'executing'
                current_task = self.agent.current_task

            status = {
                'type': 'status',
                'state': state,
                'current_task': current_task,
                'actions_taken': len(self.agent.action_history) if self.agent else 0
            }

            await websocket.send(json.dumps(status))

        except Exception as error:
            print(f'[WebSocket] Error sending status: {error}')

    async def _narration_callback(self, text: str, timing: str):
        """
        Callback for agent narration

        Args:
            text: Narration text
            timing: 'before_action' | 'after_action' | 'observation' | 'completion'
        """
        message = {
            'type': 'narration',
            'text': text,
            'timing': timing
        }

        await self.broadcast(message)

    async def broadcast(self, message: dict):
        """
        Send message to all connected clients

        Args:
            message: Dictionary to send as JSON
        """
        if not self.active_connections:
            print('[WebSocket] No active connections to broadcast to')
            return

        message_json = json.dumps(message)

        # Send to all connections
        tasks = [
            ws.send(message_json)
            for ws in self.active_connections
        ]

        # Wait for all sends to complete
        await asyncio.gather(*tasks, return_exceptions=True)

        print(f'[WebSocket] Broadcasted {message["type"]} to {len(self.active_connections)} client(s)')

    async def send_action(self, action: str, args: dict, description: str):
        """
        Send action notification

        Args:
            action: Action name
            args: Action arguments
            description: Human-readable description
        """
        message = {
            'type': 'action',
            'action': action,
            'args': args,
            'description': description
        }

        await self.broadcast(message)

    async def send_task_complete(self, success: bool, summary: str):
        """
        Send task completion notification

        Args:
            success: Whether task completed successfully
            summary: Completion summary
        """
        message = {
            'type': 'task_complete',
            'success': success,
            'summary': summary
        }

        await self.broadcast(message)

    async def send_error(self, error_message: str, recoverable: bool = False):
        """
        Send error notification

        Args:
            error_message: Error message
            recoverable: Whether error is recoverable
        """
        message = {
            'type': 'error',
            'message': error_message,
            'recoverable': recoverable
        }

        await self.broadcast(message)
