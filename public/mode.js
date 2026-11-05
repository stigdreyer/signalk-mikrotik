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
    ["allowlist.html", "Allowlist", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6l1.8 1.8L8 4.5"/><path d="M3 13l1.8 1.8L8 11.5"/><path d="M11 6.5h6M11 13.5h6"/></svg>']
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
    badge.hidden = false;
    badge.className = metered ? "badge state" : "badge state normal";
    badge.textContent = metered ? "Metered" : "Normal";
    badge.title = metered ? "Metered: only the allowed services get through" : "Normal: everything gets through";
  }
  /** Pages call this with the profile from their data. */
  window.setRouterProfile = (p) => { profile = p; showProfile(); };

  apply(); // before the first paint, so night doesn't flash white
  document.addEventListener("DOMContentLoaded", header);
  poll();
  setInterval(poll, 30_000);
})();
