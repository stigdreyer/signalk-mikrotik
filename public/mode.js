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
  const BRAND = '<a class="brand" href="index.html"><svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 16a8.5 8.5 0 0 1 17 0"/><path d="M6.2 16h-2.7M20.5 16h-2.7M12 7.5V5M6 10l-1.8-1.8M18 10l1.8-1.8"/><path d="M12 16l3.6-4.6"/><circle cx="12" cy="16" r="1.4"/><path d="M3 19.5h18"/></svg><span><span class="brand-name">Metered firewall</span><span class="brand-sub">MikroTik · Signal K</span></span></a>';
  const PAGES = [
    ["index.html", "Data usage", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16.5h14"/><path d="M5.5 13.5v-3M10 13.5v-7M14.5 13.5V9"/></svg>'],
    ["allowlist.html", "Allowlist", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6l1.8 1.8L8 4.5"/><path d="M3 13l1.8 1.8L8 11.5"/><path d="M11 6.5h6M11 13.5h6"/></svg>']
  ];
  function header() {
    const bar = document.querySelector("header.appbar");
    if (!bar) return;
    const here = location.pathname.split("/").pop() || "index.html";
    const tabs = PAGES.map(([href, label, icon]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${icon}<span>${label}</span></a>`).join("");
    bar.innerHTML = `<div class="appbar-in">${BRAND}<nav class="tabs" aria-label="Pages">${tabs}</nav></div>`;
    bar.querySelector("nav").before(group); // right of the brand, above the tabs
  }

  apply(); // before the first paint, so night doesn't flash white
  document.addEventListener("DOMContentLoaded", header);
  poll();
  setInterval(poll, 30_000);
})();
