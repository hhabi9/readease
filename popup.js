const $ = (id) => document.getElementById(id);

let tabId = null;

// Broadcasts to every frame in the tab (each applies the action); the
// returned value is the first frame's response.
function send(message) {
  return chrome.tabs.sendMessage(tabId, message);
}

// State shown in the popup must come from the top frame specifically -
// with all_frames content scripts, an ad iframe could answer first.
function sendTop(message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

function showScale(scale) {
  $("scale-value").textContent = scale + "%";
  $("size-slider").value = scale;
}

function selectSwatch(color) {
  for (const btn of document.querySelectorAll(".swatch")) {
    btn.classList.toggle("selected", btn.dataset.color === color);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;

  let state;
  try {
    state = await sendTop({ type: "get-state" });
  } catch {
    state = null;
  }
  if (!state) {
    $("app").hidden = true;
    $("unavailable").hidden = false;
    return;
  }

  showScale(state.scale);
  $("hl-toggle").checked = state.highlighterOn;
  selectSwatch(state.color);

  // Absolute values only: broadcasting a relative "adjust" would move each
  // frame off its own scale, and any frame's response could drive the UI.
  const applyScaleValue = async (value) => {
    const { scale } = await send({ type: "set-scale", value });
    showScale(scale);
  };
  $("size-slider").addEventListener("input", (e) => applyScaleValue(Number(e.target.value)));
  $("size-up").addEventListener("click", () => applyScaleValue(Number($("size-slider").value) + 10));
  $("size-down").addEventListener("click", () => applyScaleValue(Number($("size-slider").value) - 10));
  $("size-reset").addEventListener("click", async () => {
    const { scale } = await send({ type: "reset-scale" });
    showScale(scale);
  });

  $("hl-toggle").addEventListener("change", (e) => {
    send({ type: "set-highlighter", on: e.target.checked });
  });

  for (const btn of document.querySelectorAll(".swatch")) {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color;
      selectSwatch(color);
      send({ type: "set-color", color });
      chrome.storage.sync.set({ color });
      // Picking a color is a clear intent to highlight - switch the mode on.
      if (!$("hl-toggle").checked) {
        $("hl-toggle").checked = true;
        send({ type: "set-highlighter", on: true });
      }
    });
  }

  $("hl-clear").addEventListener("click", () => send({ type: "clear-highlights" }));
}

init();
