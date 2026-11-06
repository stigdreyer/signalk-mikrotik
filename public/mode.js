// Page chrome shared by the plugin's pages: the app bar (brand, mode control, page tabs), built here once so the
// pages carry only an empty <header class="appbar">. Then day/night mode for the plugin's pages. "auto" follows the Signal K path
// environment.mode (day/night, e.g. from signalk-derived-data), like other
// Signal K apps; Night and Day force it on this device. Three buttons rather than one that cycles, so a
// single tap at night can never jump to the bright day colours.
(() => {
  const KEY = "signalk-mikrotik-mode";
  let choice = "auto";
  let vesselMode = null;
  try {
    choice = localStorage.getItem(KEY) || "auto";
  } catch {}

  const group = Object.assign(document.createElement("span"), { className: "seg modes" });
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Display mode");
  const buttons = ["auto", "night", "day"].map((m) => {
    const b = Object.assign(document.createElement("button"), { type: "button", id: `mode:${m}`, textContent: m[0].toUpperCase() + m.slice(1) });
    b.onclick = () => {
      choice = m;
      try {
        localStorage.setItem(KEY, choice);
      } catch {}
      apply();
    };
    return b;
  });
  group.append(...buttons);
  function apply() {
    const night = choice === "night" || (choice === "auto" && vesselMode === "night");
    if (night) document.documentElement.setAttribute("data-mode", "night");
    else document.documentElement.removeAttribute("data-mode");
    for (const b of buttons) b.setAttribute("aria-pressed", b.id === `mode:${choice}`);
    buttons[0].textContent = `Auto · ${vesselMode === "night" ? "night" : "day"}`; // what Auto would show now, even while Night or Day is forced
    // The phone's status bar and tab strip take the header band's colour, so night mode stays dark up there too.
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.content = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || theme.content;
  }

  async function poll() {
    try {
      const res = await fetch("/signalk/v1/api/vessels/self/environment/mode", { credentials: "same-origin" });
      const v = res.ok ? (await res.json()).value : null;
      vesselMode = v === "night" || v === "day" ? v : null;
    } catch {
      vesselMode = null;
    }
    apply();
  }

  // Static markup only, no data, so innerHTML is safe here.
  const BRAND = '<a class="brand" href="index.html"><svg class="mark" viewBox="0 0 256 256" aria-hidden="true"><g transform="translate(0 -1) rotate(-45 128 128)"><path class="ring" fill-rule="evenodd" d="M227.87 99A104 104 0 1 0 227.87 157L189.51 157A68 68 0 1 1 189.51 99Z"/><path class="lever" d="M128 110H220A18 18 0 0 1 220 146H128Z"/><path class="lever" d="M94 128A34 34 0 1 0 162 128A34 34 0 1 0 94 128Z"/></g></svg><span><span class="brand-name">MikroTik Data Meter</span><span class="brand-sub">for Signal K</span></span></a>';
  const PAGES = [
    ["index.html", "Data usage", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16.5h14"/><path d="M5.5 13.5v-3M10 13.5v-7M14.5 13.5V9"/></svg>'],
    ["allowlist.html", "Allowlist", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6l1.8 1.8L8 4.5"/><path d="M3 13l1.8 1.8L8 11.5"/><path d="M11 6.5h6M11 13.5h6"/></svg>'],
    ["setup.html", "Setup", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h3M10 6h7M3 14h8M15 14h2"/><circle cx="8" cy="6" r="2"/><circle cx="13" cy="14" r="2"/></svg>'],
  ];
  function header() {
    const bar = document.querySelector("header.appbar");
    if (!bar) return;
    const here = location.pathname.split("/").pop() || "index.html";
    const tabs = PAGES.map(([href, label, icon]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${icon}<span>${label}</span></a>`).join("");
    bar.innerHTML = `<div class="appbar-in"><div class="who">${BRAND}<span class="badge state" id="appstate" role="status" hidden></span></div>` +
      `<nav class="tabs" aria-label="Pages">${tabs}</nav></div>`;
    bar.querySelector("nav").before(group); // right of the brand, above the tabs
    showProfile();
  }

  // The router's profile next to the name, on every page: the one thing the crew should always see.
  let profile = null;
  function showProfile() {
    const badge = document.getElementById("appstate");
    if (!badge || !profile) return;
    const metered = profile === "metered";
    const text = metered ? "Router: Metered" : "Router: Normal"; // "Router:" so it isn't read as a display mode like Night
    if (badge.textContent === text && !badge.hidden) return; // it's a live region: say it again only when it changes
    badge.hidden = false;
    badge.className = metered ? "badge state" : "badge state normal";
    badge.textContent = text;
    badge.title = metered ? "Metered: only the allowed services get through" : "Normal: everything gets through";
  }
  /** Pages call this with the profile from their data. */
  window.setRouterProfile = (p) => { profile = p; showProfile(); };

  /** When the plugin isn't running, a page shows a card that says so and where to go: Setup. Centred and boxed, so it
      can't be mistaken for the page itself. */
  const WHAT = {
    "index.html": "Data usage shows what went over the router's internet connection, metered and normal.",
    "allowlist.html": "The Allowlist is where you choose what gets through while the connection is metered.",
  };
  const ICON = {
    setup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4M12 7h8M4 17h9M17 17h3"/><circle cx="10" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/></svg>',
    unplugged: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/><path d="M4 4l16 16"/></svg>',
  };
  window.showNotReady = async () => {
    const main = document.querySelector("main");
    if (!main || main.querySelector(".notready")) return;
    let st = null;
    try {
      st = await (await fetch("/plugins/signalk-mikrotik/setup", { credentials: "same-origin" })).json();
    } catch {}
    const broken = Boolean(st?.setUp && st.error);
    const page = location.pathname.split("/").pop() || "index.html";
    const panel = document.createElement("section");
    panel.className = "notready";
    panel.setAttribute("aria-labelledby", "notready-title");
    panel.innerHTML = `<div class="notready-icon">${ICON[broken ? "unplugged" : "setup"]}</div><h1 id="notready-title"></h1>` +
      '<p class="what"></p><p class="why"></p><a class="primary" href="setup.html"></a>';
    panel.querySelector("h1").textContent = broken ? "Not connected to the router" : "Not set up yet";
    panel.querySelector(".what").textContent = WHAT[page] ? `${WHAT[page]} It needs the plugin connected to your MikroTik router first.`
      : "This page needs the plugin connected to your MikroTik router first.";
    panel.querySelector(".why").textContent = broken ? st.error : "Setup connects it in four short steps, and you come back here when it's running.";
    panel.querySelector(".why").classList.toggle("error", broken);
    panel.querySelector("a").textContent = broken ? "Fix it in Setup" : "Open Setup";
    main.classList.add("is-notready");
    main.prepend(panel);
  };

  // Opening the app (from the Signal K app list, a bookmark or the home screen) lands where the boat's state points:
  // Setup until the plugin runs, the Allowlist while metered, Data usage otherwise. Only on entry from outside the
  // app: a tab click, a reload or Back stays where the user went.
  (function entry() {
    const nav = performance.getEntriesByType?.("navigation")[0];
    const dir = location.pathname.replace(/[^/]*$/, "");
    let fromApp = false;
    try {
      const ref = new URL(document.referrer);
      fromApp = ref.origin === location.origin && ref.pathname.startsWith(dir);
    } catch {}
    const page = location.pathname.slice(dir.length) || "index.html";
    if (page !== "index.html" || fromApp || (nav && nav.type !== "navigate")) return;
    const root = document.documentElement;
    const show = () => root.classList.remove("routing");
    root.classList.add("routing"); // hide Data usage until we know it's the right page, so it doesn't flash
    setTimeout(show, 1500); // a slow server never leaves the page blank
    fetch("/plugins/signalk-mikrotik/setup", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((st) => {
        const to = !st.setUp || !st.running ? "setup.html" : st.profile === "metered" ? "allowlist.html" : null;
        if (to) location.replace(to); // replace: Back doesn't return to a page the user never chose
        else show();
      })
      .catch(show);
  })();

  apply(); // before the first paint, so night doesn't flash white
  document.addEventListener("DOMContentLoaded", header);
  poll();
  setInterval(() => document.hidden || poll(), 30_000); // a tablet left open at the chart table doesn't poll in the background
  document.addEventListener("visibilitychange", () => document.hidden || poll());
})();
