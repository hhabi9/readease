// ReadEase content script: text-size scaling + reading highlighter.
(() => {
  "use strict";

  const MIN_SCALE = 50;
  const MAX_SCALE = 250;
  const DEFAULT_COLOR = "#ffe066";
  const HOST_KEY = "site:" + location.hostname;

  // Original metrics are stashed on the element itself so we can rescale or
  // restore without a second lookup pass.
  const ORIG = Symbol("readeaseOrig");

  const state = {
    scale: 100,
    highlighterOn: false,
    color: DEFAULT_COLOR,
  };

  // ---------------------------------------------------------------------
  // Text scaling
  // ---------------------------------------------------------------------

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "META", "LINK",
    "OPTION", "IFRAME", "OBJECT", "EMBED",
  ]);
  const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

  function hasDirectText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.data.trim()) return true;
    }
    return false;
  }

  function isScalable(el) {
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el instanceof SVGElement) return false;
    if (el.id === "readease-toast") return false;
    return FORM_TAGS.has(el.tagName) || hasDirectText(el);
  }

  function scaleElement(el, factor) {
    let orig = el[ORIG];
    if (!orig) {
      const cs = getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize);
      if (!fontSize) return;
      orig = {
        fontSize,
        lineHeight: cs.lineHeight.endsWith("px") ? parseFloat(cs.lineHeight) : null,
        inlineFs: el.style.getPropertyValue("font-size"),
        inlineFsPrio: el.style.getPropertyPriority("font-size"),
        inlineLh: el.style.getPropertyValue("line-height"),
        inlineLhPrio: el.style.getPropertyPriority("line-height"),
      };
      el[ORIG] = orig;
    }
    if (factor === 1) {
      // Put back whatever inline style the page originally had.
      if (orig.inlineFs) el.style.setProperty("font-size", orig.inlineFs, orig.inlineFsPrio);
      else el.style.removeProperty("font-size");
      if (orig.inlineLh) el.style.setProperty("line-height", orig.inlineLh, orig.inlineLhPrio);
      else el.style.removeProperty("line-height");
      delete el[ORIG];
    } else {
      el.style.setProperty("font-size", orig.fontSize * factor + "px", "important");
      if (orig.lineHeight) {
        el.style.setProperty("line-height", orig.lineHeight * factor + "px", "important");
      }
    }
  }

  function applyScale(root) {
    const factor = state.scale / 100;
    if (!document.body) return;
    const scope = root && root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (scope !== document.body && !scope.isConnected) return;
    const elements = [scope, ...scope.querySelectorAll("*")];
    for (const el of elements) {
      if (factor === 1) {
        // On reset, restore anything we touched, not just current text holders.
        if (el[ORIG]) scaleElement(el, 1);
      } else if (isScalable(el)) {
        scaleElement(el, factor);
      }
    }
  }

  function setScale(value, { persist = true, announce = false } = {}) {
    state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value / 10) * 10));
    applyScale();
    if (persist) {
      if (state.scale === 100) {
        chrome.storage.sync.remove(HOST_KEY);
      } else {
        chrome.storage.sync.set({ [HOST_KEY]: { scale: state.scale } });
      }
    }
    if (announce) toast(`Text size: ${state.scale}%`);
  }

  // Rescale content that appears after the initial pass (infinite scroll,
  // SPAs). Only active while a non-default scale is set.
  let pendingRoots = new Set();
  let flushTimer = null;
  const observer = new MutationObserver((mutations) => {
    if (state.scale === 100) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !node.closest("mark.readease-highlight")) {
          pendingRoots.add(node);
        }
      }
    }
    if (pendingRoots.size && !flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const roots = pendingRoots;
        pendingRoots = new Set();
        for (const root of roots) applyScale(root);
      }, 150);
    }
  });

  // ---------------------------------------------------------------------
  // Reading highlighter
  // ---------------------------------------------------------------------

  const NO_HIGHLIGHT_PARENTS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "TITLE"]);

  function textNodesInRange(range) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) return [root];
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function highlightRange(range) {
    if (range.collapsed) return 0;
    let wrapped = 0;
    for (const node of textNodesInRange(range)) {
      const parent = node.parentNode;
      if (!parent || NO_HIGHLIGHT_PARENTS.has(parent.nodeName)) continue;
      if (parent.closest?.("mark.readease-highlight")) continue;

      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (end <= start || !node.data.slice(start, end).trim()) continue;

      if (end < node.data.length) node.splitText(end);
      const target = start > 0 ? node.splitText(start) : node;

      const mark = document.createElement("mark");
      mark.className = "readease-highlight";
      mark.style.backgroundColor = state.color;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      wrapped++;
    }
    return wrapped;
  }

  function onMouseUp() {
    if (!state.highlighterOn) return;
    // Let the browser finalize the selection first.
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      let wrapped = 0;
      for (let i = 0; i < sel.rangeCount; i++) {
        wrapped += highlightRange(sel.getRangeAt(i));
      }
      if (wrapped) sel.removeAllRanges();
    }, 0);
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  }

  function onClick(event) {
    if (!state.highlighterOn) return;
    const mark = event.target.closest?.("mark.readease-highlight");
    if (!mark) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // this was a drag-select, not a click
    unwrapMark(mark);
  }

  function clearHighlights() {
    const marks = document.querySelectorAll("mark.readease-highlight");
    for (const mark of marks) unwrapMark(mark);
    return marks.length;
  }

  function setHighlighter(on, { announce = false } = {}) {
    state.highlighterOn = on;
    document.documentElement.classList.toggle("readease-hl-mode", on);
    if (announce) toast(on ? "Highlighter on - select text to highlight" : "Highlighter off");
  }

  // ---------------------------------------------------------------------
  // Toast (feedback for keyboard shortcuts)
  // ---------------------------------------------------------------------

  let toastTimer = null;
  function toast(message) {
    if (window !== window.top) return; // only in the top frame
    let el = document.getElementById("readease-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "readease-toast";
      document.documentElement.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("readease-toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("readease-toast-visible"), 1600);
  }

  // ---------------------------------------------------------------------
  // Messaging + init
  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "get-state":
        sendResponse({
          scale: state.scale,
          highlighterOn: state.highlighterOn,
          color: state.color,
          highlightCount: document.querySelectorAll("mark.readease-highlight").length,
        });
        break;
      case "set-scale":
        setScale(msg.value);
        sendResponse({ scale: state.scale });
        break;
      case "adjust-scale":
        setScale(state.scale + msg.delta, { announce: true });
        sendResponse({ scale: state.scale });
        break;
      case "reset-scale":
        setScale(100, { announce: true });
        sendResponse({ scale: state.scale });
        break;
      case "set-highlighter":
        setHighlighter(!!msg.on);
        sendResponse({ highlighterOn: state.highlighterOn });
        break;
      case "toggle-highlighter":
        setHighlighter(!state.highlighterOn, { announce: true });
        sendResponse({ highlighterOn: state.highlighterOn });
        break;
      case "set-color":
        state.color = msg.color || DEFAULT_COLOR;
        sendResponse({ color: state.color });
        break;
      case "clear-highlights":
        sendResponse({ cleared: clearHighlights() });
        break;
    }
  });

  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("click", onClick);

  chrome.storage.sync.get([HOST_KEY, "color"], (res) => {
    if (chrome.runtime.lastError) return;
    if (res.color) state.color = res.color;
    const saved = res[HOST_KEY]?.scale;
    if (saved && saved !== 100) setScale(saved, { persist: false });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
