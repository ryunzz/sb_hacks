"""
Gemini Computer Use Agent - Sync implementation following Google's BrowserAgent pattern
Migrated from async to sync to align with Google's official Computer Use implementation
"""

import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Callable
from termcolor import cprint
import termcolor

from google import genai
from google.genai import types
from google.genai.types import (
    Content,
    Part,
    GenerateContentConfig,
    Candidate,
    FunctionResponse,
    FinishReason,
)

from computers import Computer, EnvState


# Constants
MODEL = "gemini-2.5-computer-use-preview-10-2025"
MAX_RECENT_TURN_WITH_SCREENSHOTS = 3
PREDEFINED_COMPUTER_USE_FUNCTIONS = [
    "open_web_browser",
    "click_at",
    "hover_at",
    "type_text_at",
    "scroll_document",
    "scroll_at",
    "wait_5_seconds",
    "go_back",
    "go_forward",
    "search",
    "navigate",
    "key_combination",
    "drag_and_drop",
]


class BrowserAgent:
    """
    Gemini Computer Use Agent - Sync implementation following Google's pattern
    with WebSocket integration for Chrome extension communication
    """

    def __init__(
        self,
        browser_computer: Computer,
        query: str,
        model_name: str = MODEL,
        send_callback: Optional[Callable] = None,
        max_turns: int = 100,
    ):
        """
        Initialize BrowserAgent

        Args:
            browser_computer: Computer interface implementation
            query: User task description
            model_name: Gemini model name
            send_callback: Optional callback for WebSocket messages
            max_turns: Maximum iterations before stopping
        """
        self._browser_computer = browser_computer
        self._query = query
        self._model_name = model_name
        self.send_callback = send_callback
        self.max_turns = max_turns

        # Agent state
        self.interrupt_flag = False
        self.new_instruction = None
        self.action_history = []  # Track last actions for stuck detection
        self.running = False
        self.final_reasoning = None
        self.turn_count = 0

        # Load API key
        api_key = self._load_api_key()

        # Initialize Gemini client
        self._client = genai.Client(api_key=api_key)

        # Initialize conversation with query
        self._contents: List[Content] = [
            Content(
                role="user",
                parts=[Part(text=self._query)],
            )
        ]

        # Configure model (match Google's settings)
        self._generate_content_config = GenerateContentConfig(
            temperature=1,
            top_p=0.95,
            top_k=40,
            max_output_tokens=8192,
            tools=[
                types.Tool(
                    computer_use=types.ComputerUse(
                        environment=types.Environment.ENVIRONMENT_BROWSER,
                        excluded_predefined_functions=[],
                    ),
                ),
            ],
            thinking_config=types.ThinkingConfig(include_thoughts=True),
        )

        print(f"[BrowserAgent] ✓ Initialized with query: {query}")

    def _load_api_key(self) -> str:
        """Load Gemini API key from file"""
        key_path = Path(__file__).parent / "gemini_api_key"
        if not key_path.exists():
            raise RuntimeError(
                "Missing API key file. Create 'gemini_api_key' in backend/ folder."
            )
        key = key_path.read_text(encoding="utf-8").strip()
        if not key:
            raise RuntimeError("'gemini_api_key' file is empty.")
        return key

    def denormalize_x(self, x: int) -> int:
        """Convert normalized x coordinate (0-1000) to pixel coordinate"""
        return int(x / 1000 * self._browser_computer.screen_size()[0])

    def denormalize_y(self, y: int) -> int:
        """Convert normalized y coordinate (0-1000) to pixel coordinate"""
        return int(y / 1000 * self._browser_computer.screen_size()[1])

    def generate_narration(self, name: str, args: Dict[str, Any]) -> str:
        """
        Generate human-readable narration for an action

        Args:
            name: Action name (e.g., "click_at", "type_text_at")
            args: Action arguments

        Returns:
            str: Narration text for TTS
        """
        if name == "click_at":
            return "Clicking on the element"
        elif name == "hover_at":
            return "Moving mouse to element"
        elif name == "type_text_at":
            text = args.get("text", "")
            if len(text) > 50:
                text = text[:50] + "..."
            return f"Typing '{text}' into the input field"
        elif name == "navigate":
            url = args.get("url", "")
            domain = url.split("//")[-1].split("/")[0] if "//" in url else url
            return f"Navigating to {domain}"
        elif name == "scroll_document":
            direction = args.get("direction", "down")
            return f"Scrolling {direction}"
        elif name == "scroll_at":
            direction = args.get("direction", "down")
            return f"Scrolling {direction} at position"
        elif name == "key_combination":
            keys = args.get("keys", "")
            return f"Pressing {keys}"
        elif name == "drag_and_drop":
            return "Dragging element"
        elif name == "go_back":
            return "Going back"
        elif name == "go_forward":
            return "Going forward"
        elif name == "wait_5_seconds":
            return "Waiting 5 seconds"
        elif name == "search":
            return "Searching on Google"
        else:
            return f"Executing {name}"

    def handle_action(self, action: types.FunctionCall) -> EnvState:
        """
        Handles the action and returns the environment state

        Args:
            action: FunctionCall from model

        Returns:
            EnvState: Environment state after action
        """
        name = action.name
        args = dict(action.args or {})

        # Track action for stuck detection
        self.action_history.append(name)
        if len(self.action_history) > 10:
            self.action_history = self.action_history[-10:]

        # Send narration BEFORE executing action
        if self.send_callback:
            narration = self.generate_narration(name, args)
            try:
                self.send_callback({"type": "narration", "text": narration})
            except Exception as e:
                print(f"Warning: Could not send narration: {e}")

        print(f"→ {name} {args}")

        # Dispatch action to Computer
        try:
            if name == "open_web_browser":
                return self._browser_computer.open_web_browser()

            elif name == "click_at":
                x = self.denormalize_x(args["x"])
                y = self.denormalize_y(args["y"])
                return self._browser_computer.click_at(x=x, y=y)

            elif name == "hover_at":
                x = self.denormalize_x(args["x"])
                y = self.denormalize_y(args["y"])
                return self._browser_computer.hover_at(x=x, y=y)

            elif name == "type_text_at":
                x = self.denormalize_x(args["x"])
                y = self.denormalize_y(args["y"])
                press_enter = args.get("press_enter", False)
                clear_before_typing = args.get("clear_before_typing", True)
                return self._browser_computer.type_text_at(
                    x=x,
                    y=y,
                    text=args["text"],
                    press_enter=press_enter,
                    clear_before_typing=clear_before_typing,
                )

            elif name == "scroll_document":
                return self._browser_computer.scroll_document(args["direction"])

            elif name == "scroll_at":
                x = self.denormalize_x(args["x"])
                y = self.denormalize_y(args["y"])
                magnitude = args.get("magnitude", 800)
                direction = args["direction"]

                if direction in ("up", "down"):
                    magnitude = self.denormalize_y(magnitude)
                elif direction in ("left", "right"):
                    magnitude = self.denormalize_x(magnitude)
                else:
                    raise ValueError("Unknown direction: ", direction)

                return self._browser_computer.scroll_at(
                    x=x, y=y, direction=direction, magnitude=magnitude
                )

            elif name == "wait_5_seconds":
                return self._browser_computer.wait_5_seconds()

            elif name == "go_back":
                return self._browser_computer.go_back()

            elif name == "go_forward":
                return self._browser_computer.go_forward()

            elif name == "search":
                return self._browser_computer.search()

            elif name == "navigate":
                return self._browser_computer.navigate(args["url"])

            elif name == "key_combination":
                keys = args["keys"]
                # Handle both string and list formats
                if isinstance(keys, str):
                    keys = keys.split("+")
                return self._browser_computer.key_combination(keys)

            elif name == "drag_and_drop":
                x = self.denormalize_x(args["x"])
                y = self.denormalize_y(args["y"])
                destination_x = self.denormalize_x(args["destination_x"])
                destination_y = self.denormalize_y(args["destination_y"])
                return self._browser_computer.drag_and_drop(
                    x=x, y=y, destination_x=destination_x, destination_y=destination_y
                )

            else:
                raise ValueError(f"Unsupported function: {name}")

        except Exception as e:
            print(f"❌ Error in {name}: {e}")

            # Send error to extension
            if self.send_callback:
                try:
                    self.send_callback({
                        "type": "error",
                        "message": f"Action '{name}' failed: {str(e)}"
                    })
                except Exception:
                    pass

            # Still return current state
            return self._browser_computer.current_state()

    def get_model_response(
        self, max_retries=5, base_delay_s=1
    ) -> types.GenerateContentResponse:
        """
        Get response from Gemini with exponential backoff retry

        Args:
            max_retries: Maximum retry attempts
            base_delay_s: Base delay in seconds for exponential backoff

        Returns:
            GenerateContentResponse from Gemini
        """
        for attempt in range(max_retries):
            try:
                response = self._client.models.generate_content(
                    model=self._model_name,
                    contents=self._contents,
                    config=self._generate_content_config,
                )
                return response
            except Exception as e:
                print(f"API Error: {e}")
                if attempt < max_retries - 1:
                    delay = base_delay_s * (2**attempt)
                    message = (
                        f"Generating content failed on attempt {attempt + 1}. "
                        f"Retrying in {delay} seconds..."
                    )
                    termcolor.cprint(message, color="yellow")
                    time.sleep(delay)
                else:
                    termcolor.cprint(
                        f"Generating content failed after {max_retries} attempts.",
                        color="red",
                    )
                    # Send error to extension
                    if self.send_callback:
                        try:
                            self.send_callback({
                                "type": "error",
                                "message": f"Gemini API error after {max_retries} attempts: {str(e)}"
                            })
                        except Exception:
                            pass
                    raise

    def get_text(self, candidate: Candidate) -> Optional[str]:
        """Extracts the text from the candidate"""
        if not candidate.content or not candidate.content.parts:
            return None
        text = []
        for part in candidate.content.parts:
            if part.text:
                text.append(part.text)
        return " ".join(text) or None

    def extract_function_calls(self, candidate: Candidate) -> List[types.FunctionCall]:
        """Extracts the function calls from the candidate"""
        if not candidate.content or not candidate.content.parts:
            return []
        ret = []
        for part in candidate.content.parts:
            if part.function_call:
                ret.append(part.function_call)
        return ret

    def ask_confirmation(self, safety_decision: Dict[str, Any]) -> bool:
        """
        Ask user for confirmation on potentially risky actions (HITL)

        Args:
            safety_decision: Safety decision dictionary from model

        Returns:
            bool: True if user confirms, False otherwise
        """
        cprint("\n⚠ Safety check: confirmation required", "yellow")
        print(safety_decision.get("explanation", ""))

        # TODO: Send confirmation request to extension via WebSocket
        # For now, auto-approve (user can interrupt if needed)
        print("Auto-approving (user can interrupt via extension)")
        return True

    def is_stuck(self) -> bool:
        """
        Check if agent is stuck (repeating same action)

        Returns:
            bool: True if stuck, False otherwise
        """
        if len(self.action_history) < 5:
            return False

        # Check if last 5 actions are identical
        # We stringify names (and args if we tracked them) to compare
        last_five = self.action_history[-5:]
        return len(set(last_five)) == 1

    def prune_screenshots(self):
        """
        Keep only screenshots from most recent turns to reduce context size
        Following Google's pattern: keep MAX_RECENT_TURN_WITH_SCREENSHOTS
        """
        turn_with_screenshots_found = 0
        for content in reversed(self._contents):
            if content.role == "user" and content.parts:
                # Check if content has screenshot of predefined computer use functions
                has_screenshot = False
                for part in content.parts:
                    if (
                        part.function_response
                        and part.function_response.parts
                        and part.function_response.name in PREDEFINED_COMPUTER_USE_FUNCTIONS
                    ):
                        has_screenshot = True
                        break

                if has_screenshot:
                    turn_with_screenshots_found += 1
                    # Remove the screenshot image if exceeds limit
                    if turn_with_screenshots_found > MAX_RECENT_TURN_WITH_SCREENSHOTS:
                        for part in content.parts:
                            if (
                                part.function_response
                                and part.function_response.parts
                                and part.function_response.name in PREDEFINED_COMPUTER_USE_FUNCTIONS
                            ):
                                part.function_response.parts = None

    def run_one_iteration(self) -> Literal["COMPLETE", "CONTINUE"]:
        """
        Run one iteration of the agent loop

        Returns:
            "COMPLETE" if task is done, "CONTINUE" to keep going
        """
        self.turn_count += 1
        print(f"\n----- TURN {self.turn_count}/{self.max_turns} -----")

        # Check for user interruption
        if self.interrupt_flag:
            print(f"[BrowserAgent] ⚠ Interrupted with new instruction: {self.new_instruction}")

            # Send narration
            if self.send_callback:
                try:
                    self.send_callback({
                        "type": "narration",
                        "text": f"Adjusting to new instruction: {self.new_instruction}"
                    })
                except Exception:
                    pass

            # Add interruption to conversation
            self._contents.append(
                Content(
                    role="user",
                    parts=[Part(text=f"STOP. New instruction: {self.new_instruction}")],
                )
            )

            # Reset flags
            self.interrupt_flag = False
            self.new_instruction = None
            self.action_history = []  # Reset stuck detection
            return "CONTINUE"

        # Check if stuck
        if self.is_stuck():
            print("[BrowserAgent] ⚠ Agent appears stuck (repeating same action)")
            if self.send_callback:
                try:
                    self.send_callback({
                        "type": "error",
                        "message": "Agent appears stuck. Please provide more specific instructions or interrupt."
                    })
                except Exception:
                    pass
            return "COMPLETE"

        # Check turn limit
        if self.turn_count >= self.max_turns:
            print(f"\n⏹ Reached maximum turn limit ({self.max_turns}). Stopping.")
            if self.send_callback:
                try:
                    self.send_callback({
                        "type": "task_complete",
                        "success": False,
                        "summary": f"Task did not complete within {self.max_turns} turns."
                    })
                except Exception:
                    pass
            return "COMPLETE"

        # Generate response from model
        try:
            response = self.get_model_response()
        except Exception as e:
            print(f"[BrowserAgent] ❌ API Error: {e}")
            return "COMPLETE"

        if not response.candidates:
            print("Response has no candidates!")
            print(response)
            return "COMPLETE"

        # Extract candidate
        candidate = response.candidates[0]

        # Append the model turn to conversation history
        if candidate.content:
            self._contents.append(candidate.content)

        reasoning = self.get_text(candidate)
        function_calls = self.extract_function_calls(candidate)

        # Retry the request in case of malformed FCs
        if (
            not function_calls
            and not reasoning
            and candidate.finish_reason == FinishReason.MALFORMED_FUNCTION_CALL
        ):
            return "CONTINUE"

        # Check if task complete (no more function calls)
        if not function_calls:
            final_text = reasoning or "Task completed"
            print(f"\n✅ Done: {final_text}")
            self.final_reasoning = final_text

            # Send completion message
            if self.send_callback:
                try:
                    self.send_callback({
                        "type": "task_complete",
                        "success": True,
                        "summary": final_text
                    })
                except Exception:
                    pass

            return "COMPLETE"

        # Print reasoning and function calls
        if reasoning:
            print(f"💭 Reasoning: {reasoning}")

        # Execute actions
        print("▶ Executing actions…")
        function_responses = []

        for function_call in function_calls:
            extra_fr_fields = {}

            # HITL - confirm potentially risky step
            if function_call.args and (safety := function_call.args.get("safety_decision")):
                if not self.ask_confirmation(safety):
                    print("⛔ User denied. Stopping.")
                    return "COMPLETE"
                extra_fr_fields["safety_acknowledgement"] = "true"

            # Execute action
            fc_result = self.handle_action(function_call)

            # Build function response with screenshot
            function_responses.append(
                FunctionResponse(
                    name=function_call.name,
                    response={
                        "url": fc_result.url,
                        **extra_fr_fields,
                    },
                    parts=[
                        types.FunctionResponsePart(
                            inline_data=types.FunctionResponseBlob(
                                mime_type="image/png", data=fc_result.screenshot
                            )
                        )
                    ],
                )
            )

        # Append function responses to conversation
        self._contents.append(
            Content(
                role="user",
                parts=[Part(function_response=fr) for fr in function_responses],
            )
        )

        # Prune old screenshots to reduce context size
        self.prune_screenshots()

        return "CONTINUE"

    def agent_loop(self):
        """
        Main agent loop - runs until task completes or max turns reached
        Following Google's simple pattern
        """
        self.running = True
        print(f"\n[BrowserAgent] 🎯 Starting task: {self._query}")

        # Get initial screenshot
        initial_state = self._browser_computer.current_state()

        # Add initial screenshot to first user message
        self._contents[0].parts.append(
            Part.from_bytes(data=initial_state.screenshot, mime_type="image/png")
        )

        # Run iterations
        status = "CONTINUE"
        while status == "CONTINUE":
            status = self.run_one_iteration()

        self.running = False
        print(f"\n[BrowserAgent] 🏁 Agent loop completed")

    def interrupt(self, new_instruction: str):
        """
        Interrupt current task with new instruction

        Args:
            new_instruction: New task to execute
        """
        print(f"[BrowserAgent] Received interruption: {new_instruction}")
        self.interrupt_flag = True
        self.new_instruction = new_instruction
