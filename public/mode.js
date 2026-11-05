// Day/night mode for the plugin's pages. "auto" follows the Signal K path
// environment.mode (day/night, e.g. from signalk-derived-data), like other
// Signal K apps; the button can force night or day on this device.
(() => {
  const KEY = "signalk-mikrotik-mode";
  const LABEL = { auto: "Mode: auto", night: "Mode: night", day: "Mode: day" };
  const NEXT = { auto: "night", night: "day", day: "auto" };
  let choice = "auto";
  let vesselMode = null;
  try {
    choice = localStorage.getItem(KEY) || "auto";
  } catch {}

  const button = Object.assign(document.createElement("button"), { className: "modebtn", type: "button" });
  function apply() {
    const night = choice === "night" || (choice === "auto" && vesselMode === "night");
    if (night) document.documentElement.setAttribute("data-mode", "night");
    else document.documentElement.removeAttribute("data-mode");
    button.textContent = LABEL[choice];
    button.title = choice === "auto" ? `Follows the vessel's day/night mode (now: ${vesselMode ?? "unknown"})` : "Click to change";
  }
  button.onclick = () => {
    choice = NEXT[choice];
    try {
      localStorage.setItem(KEY, choice);
    } catch {}
    apply();
  };

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

  apply(); // before the first paint, so night doesn't flash white
  document.addEventListener("DOMContentLoaded", () => document.querySelector("nav")?.append(button));
  poll();
  setInterval(poll, 30_000);
})();
