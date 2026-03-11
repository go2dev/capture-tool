import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  DomEventPayload,
} from "./types";

// -------------------------------------------------------
// State
// -------------------------------------------------------

let capturing = false;
let recordingStartTime = 0;

// -------------------------------------------------------
// CSS selector generation
// -------------------------------------------------------

/** Build a CSS selector that uniquely identifies the element. */
function generateSelector(el: Element): string {
  // 1. data-testid / data-test / data-cy — best-case selectors
  for (const attr of ["data-testid", "data-test", "data-cy"]) {
    const val = el.getAttribute(attr);
    if (val) {
      return `${el.tagName.toLowerCase()}[${attr}='${val}']`;
    }
  }

  // 2. id (only if reasonably stable-looking)
  if (el.id && !/^\d/.test(el.id) && !el.id.includes(":")) {
    return `#${CSS.escape(el.id)}`;
  }

  // 3. Build a path from the element up to a uniquely identifiable ancestor
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    let segment = current.tagName.toLowerCase();

    // Prefer id on an ancestor
    if (current.id && !/^\d/.test(current.id) && !current.id.includes(":")) {
      parts.unshift(`#${CSS.escape(current.id)} > ${segment}${nthOfType(current)}`);
      return parts.join(" > ");
    }

    // Add nth-of-type for disambiguation
    segment += nthOfType(current);
    parts.unshift(segment);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function nthOfType(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return "";
  const siblings = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName
  );
  if (siblings.length <= 1) return "";
  const idx = siblings.indexOf(el) + 1;
  return `:nth-of-type(${idx})`;
}

// -------------------------------------------------------
// Visible text extraction
// -------------------------------------------------------

function getVisibleText(el: Element): string {
  // For inputs, use value or placeholder
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value || el.placeholder || "";
  }
  if (el instanceof HTMLSelectElement) {
    return el.options[el.selectedIndex]?.text ?? "";
  }
  // aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  // innerText, trimmed and clamped
  const text = (el as HTMLElement).innerText ?? "";
  return text.trim().substring(0, 200);
}

// -------------------------------------------------------
// Form field label detection
// -------------------------------------------------------

function getFieldLabel(el: Element): string | null {
  // 1. <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for='${CSS.escape(el.id)}']`);
    if (label) return (label as HTMLElement).innerText.trim();
  }

  // 2. Wrapping <label>
  const closest = el.closest("label");
  if (closest) return closest.innerText.trim();

  // 3. aria-label / aria-labelledby
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const ref = document.getElementById(ariaLabelledBy);
    if (ref) return ref.innerText.trim();
  }

  // 4. placeholder as last resort for inputs
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.placeholder || null;
  }

  return null;
}

// -------------------------------------------------------
// data-test attribute extraction
// -------------------------------------------------------

function getDataTestId(el: Element): string | null {
  return (
    el.getAttribute("data-testid") ??
    el.getAttribute("data-test") ??
    el.getAttribute("data-cy") ??
    null
  );
}

// -------------------------------------------------------
// Event handlers
// -------------------------------------------------------

function handleClick(event: MouseEvent): void {
  if (!capturing) return;
  const target = event.target as Element | null;
  if (!target) return;

  const payload: DomEventPayload = {
    type: "click",
    x: event.clientX,
    y: event.clientY,
    button: event.button === 0 ? "left" : event.button === 2 ? "right" : "middle",
    tag: target.tagName.toLowerCase(),
    text: getVisibleText(target),
    selector: generateSelector(target),
    dataTestId: getDataTestId(target),
    url: location.href,
    pageTitle: document.title,
    fieldLabel: getFieldLabel(target),
    timestamp: Date.now() - recordingStartTime,
  };

  sendToBackground(payload);
}

function handleNavigation(): void {
  if (!capturing) return;

  const payload: DomEventPayload = {
    type: "window_change",
    x: null,
    y: null,
    button: null,
    tag: "document",
    text: document.title,
    selector: "",
    dataTestId: null,
    url: location.href,
    pageTitle: document.title,
    fieldLabel: null,
    timestamp: Date.now() - recordingStartTime,
  };

  sendToBackground(payload);
}

// -------------------------------------------------------
// Communication with background script
// -------------------------------------------------------

function sendToBackground(payload: DomEventPayload): void {
  const msg: ContentToBackgroundMessage = {
    action: "dom_event",
    payload,
  };
  chrome.runtime.sendMessage(msg).catch(() => {
    /* extension context may have been invalidated */
  });
}

// -------------------------------------------------------
// Start / stop capture
// -------------------------------------------------------

function startCapture(): void {
  if (capturing) return;
  capturing = true;
  recordingStartTime = Date.now();

  document.addEventListener("click", handleClick, true);

  // Fire an initial navigation event so the backend knows what page we're on
  handleNavigation();
}

function stopCapture(): void {
  if (!capturing) return;
  capturing = false;
  document.removeEventListener("click", handleClick, true);
}

// -------------------------------------------------------
// Message listener from background script
// -------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: BackgroundToContentMessage, _sender, _sendResponse): undefined => {
    switch (message.action) {
      case "start_capture":
        startCapture();
        break;
      case "stop_capture":
        stopCapture();
        break;
    }
    return undefined;
  }
);
