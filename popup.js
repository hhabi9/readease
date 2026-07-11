const $ = (id) => document.getElementById(id);

let tabId = null;

function send(message) {
  return chrome.tabs.sendMessage(tabId, message);
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
    state = await send({ type: "get-state" });
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

  $("size-slider").addEventListener("input", async (e) => {
    const { scale } = await send({ type: "set-scale", value: Number(e.target.value) });
    showScale(scale);
  });
  $("size-up").addEventListener("click", async () => {
    const { scale } = await send({ type: "adjust-scale", delta: 10 });
    showScale(scale);
  });
  $("size-down").addEventListener("click", async () => {
    const { scale } = await send({ type: "adjust-scale", delta: -10 });
    showScale(scale);
  });
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
