"""
Test script to verify sync Playwright CDP connection works
"""
import sys
sys.path.insert(0, '/Users/zixiangzheng/ryunzz/sb_hacks/backend')

from computers.playwright_cdp_computer import PlaywrightCDPComputer

print("=" * 60)
print("Testing Sync Playwright CDP Connection")
print("=" * 60)
print()

try:
    with PlaywrightCDPComputer() as computer:
        print("✓ Connected to existing Chrome via CDP!")
        print(f"  Screen size: {computer.screen_size()}")
        print(f"  Current URL: {computer.current_state().url}")
        print()

        print("Testing navigation...")
        state = computer.navigate("https://www.google.com")
        print(f"✓ Navigated to: {state.url}")
        print()

        print("✓ All tests passed!")
        print("  Sync Playwright + CDP = SUCCESS!")

except Exception as e:
    print(f"✗ Test failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print()
print("=" * 60)
print("Test Complete")
print("=" * 60)
