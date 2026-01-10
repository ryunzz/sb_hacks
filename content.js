/**
 * Vision Agent - Content Script
 * Handles DOM manipulation and action execution on web pages
 */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received:', message.type);

    switch (message.type) {
        case 'click':
            handleClick(message.target).then(sendResponse);
            return true;

        case 'type':
            handleType(message.target, message.text).then(sendResponse);
            return true;

        case 'scroll':
            handleScroll(message.target).then(sendResponse);
            return true;

        case 'getPageInfo':
            sendResponse(getPageInfo());
            break;

        case 'getInteractiveElements':
            sendResponse(getInteractiveElements());
            break;

        default:
            sendResponse({ success: false, error: 'Unknown action type' });
    }
});

/**
 * Click an element by text content or selector
 */
async function handleClick(target) {
    try {
        const element = findElement(target);
        if (!element) {
            return { success: false, error: `Could not find element: ${target}` };
        }

        // Scroll element into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);

        // Highlight briefly for visual feedback
        highlightElement(element);

        // Simulate click
        element.click();

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Type text into an input element
 */
async function handleType(target, text) {
    try {
        const element = findElement(target);
        if (!element) {
            return { success: false, error: `Could not find input: ${target}` };
        }

        // Focus the element
        element.focus();
        await sleep(100);

        // Clear existing value
        element.value = '';

        // Type character by character for better compatibility
        for (const char of text) {
            element.value += char;
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: char
            }));
            await sleep(30);
        }

        // Trigger change event
        element.dispatchEvent(new Event('change', { bubbles: true }));

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Scroll the page or to an element
 */
async function handleScroll(target) {
    try {
        if (target === 'up') {
            window.scrollBy({ top: -500, behavior: 'smooth' });
        } else if (target === 'down') {
            window.scrollBy({ top: 500, behavior: 'smooth' });
        } else if (target === 'top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (target === 'bottom') {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        } else {
            // Scroll to element
            const element = findElement(target);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                return { success: false, error: `Could not find element: ${target}` };
            }
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Find element by text content, aria-label, or CSS selector
 */
function findElement(target) {
    // Try exact text match first
    let element = findByText(target);
    if (element) return element;

    // Try partial text match
    element = findByText(target, true);
    if (element) return element;

    // Try aria-label
    element = document.querySelector(`[aria-label*="${target}" i]`);
    if (element) return element;

    // Try placeholder
    element = document.querySelector(`[placeholder*="${target}" i]`);
    if (element) return element;

    // Try title
    element = document.querySelector(`[title*="${target}" i]`);
    if (element) return element;

    // Try CSS selector
    try {
        element = document.querySelector(target);
        if (element) return element;
    } catch (e) {
        // Invalid selector, ignore
    }

    // Try name attribute
    element = document.querySelector(`[name*="${target}" i]`);
    if (element) return element;

    return null;
}

/**
 * Find element by text content
 */
function findByText(text, partial = false) {
    const lowerText = text.toLowerCase();

    // Get all interactive elements
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]';
    const elements = document.querySelectorAll(selectors);

    for (const el of elements) {
        const elText = (el.textContent || el.value || el.placeholder || '').toLowerCase().trim();

        if (partial) {
            if (elText.includes(lowerText) || lowerText.includes(elText)) {
                return el;
            }
        } else {
            if (elText === lowerText) {
                return el;
            }
        }
    }

    // Also check all visible elements
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
        if (!isVisible(el)) continue;

        const elText = el.textContent?.toLowerCase().trim();
        if (!elText) continue;

        // Only match if this element directly contains the text (not a parent)
        const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ')
            .toLowerCase();

        if (partial) {
            if (directText.includes(lowerText)) {
                return el;
            }
        } else {
            if (directText === lowerText) {
                return el;
            }
        }
    }

    return null;
}

/**
 * Check if element is visible
 */
function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        element.offsetParent !== null;
}

/**
 * Highlight an element temporarily
 */
function highlightElement(element) {
    const originalOutline = element.style.outline;
    element.style.outline = '3px solid #4f9eff';

    setTimeout(() => {
        element.style.outline = originalOutline;
    }, 1000);
}

/**
 * Get basic page information
 */
function getPageInfo() {
    return {
        title: document.title,
        url: window.location.href,
        domain: window.location.hostname,
        hasInputs: document.querySelectorAll('input, textarea').length > 0,
        hasButtons: document.querySelectorAll('button, [role="button"]').length > 0,
        hasForms: document.querySelectorAll('form').length > 0
    };
}

/**
 * Get list of interactive elements on the page
 */
function getInteractiveElements() {
    const elements = [];
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"]';

    document.querySelectorAll(selectors).forEach((el, index) => {
        if (!isVisible(el)) return;

        const text = (el.textContent || el.value || el.placeholder || el.ariaLabel || '').trim();
        if (!text && el.tagName !== 'INPUT') return;

        elements.push({
            index,
            tag: el.tagName.toLowerCase(),
            type: el.type || null,
            text: text.substring(0, 100),
            href: el.href || null
        });
    });

    return elements.slice(0, 50); // Limit to first 50
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('Vision Agent content script loaded');
