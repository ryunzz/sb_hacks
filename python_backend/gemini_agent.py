"Gemini Computer Use Agent
Interfaces with Gemini 2.5 Computer Use model for autonomous browser control
""
import asyncio
import base64
from typing import Callable, List, Dict, Optional, Any
from datetime import datetime
import json
from google import genai
from google.genai import types
from google.genai.types import Content, Part
from config import Config


class GeminiAgent:
    """Gemini 2.5 Computer Use API client (V2 SDK)"""

    def __init__(self, api_key: str, playwright_controller):
        """
        Initialize Gemini agent

        Args:
            api_key: Gemini API key
            playwright_controller: PlaywrightController instance
        """
        self.api_key = api_key
        self.controller = playwright_controller
        self.client = genai.Client(api_key=api_key)
        self.model_name = Config.GEMINI_MODEL
        self.is_interrupted = False
        self.current_task = None

        print(f'[Gemini] Initialized {self.model_name} (V2 SDK)')

    async def execute_task(self, user_goal: str, narration_callback: Callable):
        """
        Execute a task autonomously using the Computer Use loop

        Args:
            user_goal: User's goal/instruction
            narration_callback: Function to call with narration text
        """
        try:
            print(f'[Gemini] Starting task: {user_goal}')
            self.current_task = user_goal
            self.is_interrupted = False

            # Capture initial state
            screenshot_bytes = await self.controller.capture_screenshot()
            
            # Prepare configuration
            config = types.GenerateContentConfig(
                tools=[
                    types.Tool(
                        computer_use=types.ComputerUse(
                            environment=types.Environment.ENVIRONMENT_BROWSER,
                        )
                    )
                ],
                thinking_config=types.ThinkingConfig(include_thoughts=True),
            )

            # Initial content: User Goal + Screenshot
            contents: List[Content] = [
                Content(
                    role="user",
                    parts=[
                        Part(text=user_goal),
                        Part.from_bytes(data=screenshot_bytes, mime_type="image/png"),
                    ],
                )
            ]

            await narration_callback(
                f"I'm starting to work on: {user_goal}",
                'observation'
            )

            # Main loop
            max_steps = 15
            for turn in range(max_steps):
                if self.is_interrupted:
                    print('[Gemini] Interrupted by user')
                    break

                print(f'\n[Gemini] === Turn {turn + 1} ===')

                # Call model (in a thread to avoid blocking async event loop)
                try:
                    response = await asyncio.to_thread(
                        self.client.models.generate_content,
                        model=self.model_name,
                        contents=contents,
                        config=config,
                    )
                except Exception as e:
                    print(f'[Gemini] API Error: {e}')
                    await narration_callback(f"I ran into an issue connecting to Gemini: {e}", 'completion')
                    return

                if not response.candidates:
                    print('[Gemini] No candidates returned')
                    break

                candidate = response.candidates[0]
                
                # Append model's response to history
                contents.append(candidate.content)

                # Check for function calls
                function_calls = [
                    p.function_call for p in candidate.content.parts 
                    if hasattr(p, "function_call") and p.function_call
                ]

                # If no function calls, check for text response (done or question)
                if not function_calls:
                    text_parts = [p.text for p in candidate.content.parts if hasattr(p, "text") and p.text]
                    final_text = " ".join(text_parts)
                    print(f'[Gemini] Response: {final_text}')
                    
                    await narration_callback(final_text, 'completion')
                    break

                # Execute actions
                print(f'[Gemini] Executing {len(function_calls)} actions...')
                results = await self._exec_calls(function_calls, narration_callback)

                # Build function responses with new screenshot
                screenshot_bytes = await self.controller.capture_screenshot()
                
                function_responses = []
                for name, result in results:
                    # Construct response part
                    function_responses.append(
                        types.FunctionResponse(
                            name=name,
                            response=result, # result is a dict
                            parts=[
                                types.FunctionResponsePart(
                                    inline_data=types.FunctionResponseBlob(
                                        mime_type="image/png", 
                                        data=screenshot_bytes
                                    )
                                )
                            ],
                        )
                    )

                # Append function responses to history
                contents.append(
                    Content(
                        role="user", 
                        parts=[Part(function_response=fr) for fr in function_responses]
                    )
                )

            else:
                await narration_callback("I've reached the maximum number of steps.", 'completion')

        except Exception as error:
            print(f'[Gemini] Task execution error: {error}')
            await narration_callback(f"Something went wrong: {error}", 'completion')
            raise

        finally:
            self.current_task = None

    async def _exec_calls(self, function_calls: List[Any], narration_callback: Callable) -> List[tuple]:
        """
        Execute a list of function calls from Gemini
        Returns: List of (function_name, result_dict)
        """
        results = []
        
        for fc in function_calls:
            if self.is_interrupted:
                break

            name = fc.name
            args = dict(fc.args or {})
            
            print(f'[Gemini] Action: {name} {args}')
            
            # Narrate action
            desc = self._describe_action(name, args)
            await narration_callback(f"I'm {desc}", 'before_action')

            result_data = {}
            try:
                if name == "open_web_browser":
                    pass # Browser already open
                
                elif name == "navigate":
                    await self.controller.navigate(args["url"])
                
                elif name == "click_at":
                    # Note: args come as normalized 0-1000
                    await self.controller.click_at(args["x"], args["y"])
                
                elif name == "type_text_at":
                    await self.controller.click_at(args["x"], args["y"])
                    # Optional: Clear field logic could go here if needed
                    await self.controller.type_text(args["text"])
                    if args.get("press_enter", True):
                        await self.controller.press_key("Enter")
                
                elif name == "type_text":
                    await self.controller.type_text(args["text"])
                
                elif name == "key_combination":
                    # Handle composite keys if necessary, or just simple keys
                    keys = args["keys"]
                    # Playwright expects "+", but Gemini might send something else. 
                    # Assuming standard Playwright format.
                    await self.controller.press_key(keys)

                elif name == "scroll_document":
                    direction = args.get("direction", "down").lower()
                    # Playwright controller 'scroll' takes 'up' or 'down'
                    if direction in ['up', 'down']:
                        await self.controller.scroll(direction)
                    elif direction == 'left':
                        # Implement horizontal if needed, or ignore
                        pass
                    elif direction == 'right':
                        pass

                elif name == "scroll_at":
                    # Map to general scroll for now, or implement specifically
                    direction = args.get("direction", "down").lower()
                    if direction in ['up', 'down']:
                        await self.controller.scroll(direction)

                else:
                    print(f'[Gemini] Unknown action: {name}')
                    result_data["warning"] = "unimplemented_action"

                # Wait for page load state if needed
                # The controller actions usually have small sleeps, but we can add more safety
                await asyncio.sleep(0.5)

            except Exception as e:
                print(f'[Gemini] Action failed: {e}')
                result_data["error"] = str(e)

            results.append((name, result_data))

        return results

    def _describe_action(self, name: str, args: Dict) -> str:
        """Generate human-readable action description"""
        if name == 'click_at':
            return f"clicking at ({args.get('x')}, {args.get('y')})"
        elif name == 'type_text_at':
            return f"typing '{args.get('text', '')}'"
        elif name == 'type_text':
            return f"typing '{args.get('text', '')}'"
        elif name == 'scroll_document':
            return f"scrolling {args.get('direction', 'down')}"
        elif name == 'navigate':
            return f"navigating to {args.get('url', '')}"
        elif name == 'press_key':
            return f"pressing {args.get('key', '')}"
        elif name == 'key_combination':
            return f"pressing {args.get('keys', '')}"
        return f"performing {name}"

    async def handle_interruption(self, new_instruction: str, narration_callback: Callable):
        """Handle user interruption"""
        print(f'[Gemini] Interruption: {new_instruction}')
        self.is_interrupted = True
        # Restart with new instruction
        await asyncio.sleep(0.5)
        # Note: This simple recursion might need safeguards against stack overflow if repeated too much,
        # but for an MVP it's fine.
        await self.execute_task(new_instruction, narration_callback)