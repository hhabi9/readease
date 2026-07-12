// End-to-end test for the ReadEase extension in headless Chrome.
const puppeteer = require("puppeteer-core");
const http = require("http");
const path = require("path");
const fs = require("fs");

const EXT = path.resolve(__dirname, "..");
const PORT = 8931;

// Regular Chrome ignores --load-extension since v137; a Chrome for Testing
// build is required. Install one with:  npm run install-chrome
function findChrome() {
  if (process.env.CHROME_FOR_TESTING) return process.env.CHROME_FOR_TESTING;
  const root = path.join(__dirname, "browsers", "chrome");
  if (fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      for (const app of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-linux64/chrome",
      ]) {
        const p = path.join(root, dir, app);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  console.error("Chrome for Testing not found. Run: npm run install-chrome");
  process.exit(2);
}
const CHROME = findChrome();

const PAGE = `<!doctype html><html><head><title>ReadEase test</title></head><body>
<p id="p1" style="font-size:16px">Hello world this is a test paragraph for ReadEase.</p>
<p id="p2">Second paragraph with default sizing for highlight tests.</p>
<div id="dyn"></div>
<p id="p4">Site handler stops propagation of mouseup on this paragraph.</p>
<div id="shadow-host"></div>
<nav id="menu" style="font-size:16px">
  <ul><li id="mi">Home</li><li>About</li></ul>
  <button id="mbtn" style="font-size:16px">Sign in</button>
  <span id="mlabel">Navigation</span>
</nav>
<iframe id="fr" srcdoc="&lt;p id='ip' style='font-size:16px'&gt;Srcdoc iframe paragraph with plenty of readable text.&lt;/p&gt;"></iframe>
<script>
  // Simulate a site (like AMBOSS) that swallows mouseup before it bubbles.
  document.getElementById("p4").addEventListener("mouseup", (e) => e.stopPropagation());
  // Simulate content rendered inside an open shadow root.
  const root = document.getElementById("shadow-host").attachShadow({ mode: "open" });
  root.innerHTML = '<p id="sp" style="font-size:16px">Shadow paragraph for scale and highlight.</p>';
</script>
</body></html>`;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().includes("background.js"),
      { timeout: 15000 }
    );
    const sw = await swTarget.worker();
    check("service worker registered", !!sw);

    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle0" });
    await sleep(600); // content script runs at document_idle

    // Extension has no "tabs" permission, so we can't query by URL here;
    // send to whichever tab has the content script (only the test page does).
    // A broadcast reaches every frame but returns whichever frame's response
    // lands first; pass { frameId: 0 } when asserting on the response value.
    const sendToTab = (msg, opts) =>
      sw.evaluate(
        async (m, o) => {
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            try {
              return o ? await chrome.tabs.sendMessage(t.id, m, o) : await chrome.tabs.sendMessage(t.id, m);
            } catch {}
          }
          return null;
        },
        msg,
        opts ?? null
      );

    // --- initial state ---
    const state = await sendToTab({ type: "get-state" });
    check("initial scale is 100", state && state.scale === 100, JSON.stringify(state));
    check("highlighter starts off", state && state.highlighterOn === false);

    // --- text scaling ---
    await sendToTab({ type: "set-scale", value: 150 });
    let fs = await page.evaluate(() => getComputedStyle(document.getElementById("p1")).fontSize);
    check("150% scales 16px paragraph to 24px", fs === "24px", fs);
    let fs2 = await page.evaluate(() => getComputedStyle(document.getElementById("p2")).fontSize);
    check("unstyled paragraph also scaled", parseFloat(fs2) === 24, fs2);

    // main-text mode (default): menus, buttons, and short labels keep their size
    let resp;
    let menuSizes = await page.evaluate(() => ({
      item: getComputedStyle(document.getElementById("mi")).fontSize,
      button: getComputedStyle(document.getElementById("mbtn")).fontSize,
      label: getComputedStyle(document.getElementById("mlabel")).fontSize,
    }));
    check(
      "menu UI untouched in main-text mode",
      menuSizes.item === "16px" && menuSizes.button === "16px" && menuSizes.label === "16px",
      JSON.stringify(menuSizes)
    );

    // whole-page mode scales UI chrome too; switching back restores it
    resp = await sendToTab({ type: "set-mode", mode: "page" }, { frameId: 0 });
    await sleep(200);
    menuSizes = await page.evaluate(() => ({
      item: getComputedStyle(document.getElementById("mi")).fontSize,
      button: getComputedStyle(document.getElementById("mbtn")).fontSize,
    }));
    check("whole-page mode scales menu", menuSizes.item === "24px" && menuSizes.button === "24px", JSON.stringify(menuSizes));
    check("set-mode responds with mode", resp && resp.mode === "page", JSON.stringify(resp));

    await sendToTab({ type: "set-mode", mode: "main" }, { frameId: 0 });
    await sleep(200);
    menuSizes = await page.evaluate(() => ({
      item: getComputedStyle(document.getElementById("mi")).fontSize,
      p1: getComputedStyle(document.getElementById("p1")).fontSize,
    }));
    check(
      "back to main-text mode restores menu, keeps prose scaled",
      menuSizes.item === "16px" && menuSizes.p1 === "24px",
      JSON.stringify(menuSizes)
    );

    // dynamically added content gets scaled by the MutationObserver
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.id = "p3";
      p.style.fontSize = "16px";
      p.textContent = "Dynamically added paragraph.";
      document.getElementById("dyn").appendChild(p);
    });
    await sleep(400);
    fs = await page.evaluate(() => getComputedStyle(document.getElementById("p3")).fontSize);
    check("dynamically added content scaled", fs === "24px", fs);

    // persists per-site across reload
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(800);
    fs = await page.evaluate(() => getComputedStyle(document.getElementById("p1")).fontSize);
    check("scale persists after reload", fs === "24px", fs);

    // adjust via shortcut-style message
    resp = await sendToTab({ type: "adjust-scale", delta: 10 });
    check("adjust-scale returns 160", resp && resp.scale === 160, JSON.stringify(resp));

    // reset restores original inline styles and cleans storage
    await sendToTab({ type: "reset-scale" });
    fs = await page.evaluate(() => getComputedStyle(document.getElementById("p1")).fontSize);
    const inline = await page.evaluate(() => document.getElementById("p1").getAttribute("style"));
    check("reset restores 16px", fs === "16px", fs);
    check(
      "reset restores original inline style",
      String(inline).replace(/[\s;]/g, "") === "font-size:16px",
      String(inline)
    );
    const stored = await sw.evaluate(() => chrome.storage.sync.get(null));
    check("storage cleaned after reset", !stored["site:localhost"], JSON.stringify(stored));

    // --- highlighter ---
    await sendToTab({ type: "set-highlighter", on: true });
    await page.evaluate(() => {
      const p = document.getElementById("p2");
      const range = document.createRange();
      range.setStart(p.firstChild, 7);
      range.setEnd(p.firstChild, 16);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await sleep(150);
    let mark = await page.evaluate(() => {
      const m = document.querySelector("mark.readease-highlight");
      return m ? { text: m.textContent, bg: getComputedStyle(m).backgroundColor } : null;
    });
    check("selection wrapped in mark", !!mark && mark.text === "paragraph", JSON.stringify(mark));
    check("default yellow applied", !!mark && mark.bg === "rgb(255, 224, 102)", mark && mark.bg);

    // click on a highlight removes it
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.click("mark.readease-highlight");
    await sleep(100);
    let count = await page.evaluate(() => document.querySelectorAll("mark.readease-highlight").length);
    check("click removes highlight", count === 0, String(count));

    // color change + cross-element selection
    await sendToTab({ type: "set-color", color: "#a8d8ff" });
    await page.evaluate(() => {
      const range = document.createRange();
      range.setStart(document.getElementById("p1").firstChild, 42);
      range.setEnd(document.getElementById("p2").firstChild, 6);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await sleep(150);
    const marks = await page.evaluate(() =>
      [...document.querySelectorAll("mark.readease-highlight")].map((m) => ({
        text: m.textContent,
        bg: getComputedStyle(m).backgroundColor,
      }))
    );
    check("cross-element selection makes 2 marks", marks.length === 2, JSON.stringify(marks));
    check("new color applied", marks.every((m) => m.bg === "rgb(168, 216, 255)"));

    // clear-highlights removes everything, text unharmed
    resp = await sendToTab({ type: "clear-highlights" }, { frameId: 0 });
    count = await page.evaluate(() => document.querySelectorAll("mark.readease-highlight").length);
    const text = await page.evaluate(() => document.getElementById("p2").textContent);
    check("clear-highlights removes all", resp.cleared === 2 && count === 0, JSON.stringify(resp));
    check("text intact after clear", text === "Second paragraph with default sizing for highlight tests.", text);

    // highlighter off -> selection does nothing
    await sendToTab({ type: "set-highlighter", on: false });
    await page.evaluate(() => {
      const p = document.getElementById("p2");
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 6);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await sleep(150);
    count = await page.evaluate(() => document.querySelectorAll("mark.readease-highlight").length);
    check("no highlight when mode off", count === 0, String(count));

    // --- AMBOSS-style regressions: shadow DOM, srcdoc iframes, stopPropagation ---

    await sendToTab({ type: "set-scale", value: 150 });
    await sleep(300);
    fs = await page.evaluate(
      () => getComputedStyle(document.getElementById("shadow-host").shadowRoot.getElementById("sp")).fontSize
    );
    check("shadow DOM content scaled", fs === "24px", fs);

    await page.evaluate(() => {
      const root = document.getElementById("shadow-host").shadowRoot;
      const p = document.createElement("p");
      p.id = "sp2";
      p.style.fontSize = "16px";
      p.textContent = "Dynamically added shadow paragraph.";
      root.appendChild(p);
    });
    await sleep(400);
    fs = await page.evaluate(
      () => getComputedStyle(document.getElementById("shadow-host").shadowRoot.getElementById("sp2")).fontSize
    );
    check("dynamic shadow DOM content scaled", fs === "24px", fs);

    const srcdocFrame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
    check("content script injected into srcdoc iframe", !!srcdocFrame);
    if (srcdocFrame) {
      fs = await srcdocFrame.evaluate(() => getComputedStyle(document.getElementById("ip")).fontSize);
      check("srcdoc iframe content scaled", fs === "24px", fs);
    }

    await sendToTab({ type: "reset-scale" });
    await sleep(300);
    fs = await page.evaluate(
      () => getComputedStyle(document.getElementById("shadow-host").shadowRoot.getElementById("sp")).fontSize
    );
    check("reset restores shadow DOM content", fs === "16px", fs);

    // capture-phase listener survives a site's stopPropagation on mouseup
    await sendToTab({ type: "set-highlighter", on: true });
    await page.evaluate(() => {
      const p = document.getElementById("p4");
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 12);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    });
    await sleep(150);
    mark = await page.evaluate(() => {
      const m = document.querySelector("#p4 mark.readease-highlight");
      return m ? { text: m.textContent } : null;
    });
    check("highlight despite site stopPropagation", !!mark && mark.text === "Site handler", JSON.stringify(mark));

    // highlight inside a shadow root
    await page.evaluate(() => {
      const root = document.getElementById("shadow-host").shadowRoot;
      const p = root.getElementById("sp");
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 6);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    });
    await sleep(150);
    mark = await page.evaluate(() => {
      const m = document
        .getElementById("shadow-host")
        .shadowRoot.querySelector("mark.readease-highlight");
      return m ? { text: m.textContent } : null;
    });
    check("highlight inside shadow root", !!mark && mark.text === "Shadow", JSON.stringify(mark));

    // clear-highlights reaches into shadow roots too
    resp = await sendToTab({ type: "clear-highlights" }, { frameId: 0 });
    count = await page.evaluate(
      () =>
        document.querySelectorAll("mark.readease-highlight").length +
        document.getElementById("shadow-host").shadowRoot.querySelectorAll("mark.readease-highlight").length
    );
    check("clear-highlights reaches shadow DOM", resp.cleared >= 2 && count === 0, JSON.stringify({ resp, count }));
    await sendToTab({ type: "set-highlighter", on: false });

    // page console errors from our content script?
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(600);
    check("no page errors on reload", errors.length === 0, errors.join("; "));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST RUN ERROR:", e);
  process.exit(2);
});
