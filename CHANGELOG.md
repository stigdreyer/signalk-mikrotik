# Changelog

What changed in each release of **MikroTik Data Meter** (`signalk-mikrotik`). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Versions before 1.0.0 were development releases; each links to its commit.

## [Unreleased]

## [1.0.1] - 2026-11-06

### Fixed
- The package names its GitHub repository in full, so the Signal K plugin registry can find the source and run the
  tests.

### Added
- Signal K's shared plugin CI, which tests every change on Linux, macOS and Windows with Node 22, 24 and 26.

## [1.0.0] - 2026-11-06

The first public release, on npm and in the Signal K Appstore.

### Added
- This changelog, a security policy, CI and an npm release workflow with provenance.

### Changed
- With Signal K's security on (2.31 or later), crew who are logged in can open Data usage and the Allowlist, and
  users with read/write access can save the allowlist. Saving settings, testing a router login and removing the
  plugin from the router still need an admin.
- README, router setup guide and test checklist match the current app; new Troubleshooting and Uninstalling
  sections.

## [0.8.1] - 2026-11-06

### Changed
- Setup: running the router script again keeps the plugin user's password, unless you press **New password**
  (the new one then goes into step 3). Steps 2 and 3 tick when the connection test passes, the first
  **Save and start** tests the connection first, and once the plugin runs the button reads **Save changes**.
- Setup explains the password field, says which warnings the step 2 script fixes, and ends with a "Running" block
  that points to the Allowlist and Data usage.
- The header badge reads **Router: Metered** or **Router: Normal**.
- Night mode: the header and selected controls meet the contrast targets; in the Data usage chart normal days are
  hatched and metered days solid.
- "Stopped lately" is now **Blocked lately**.
- When the plugin isn't set up or can't reach the router, Data usage and the Allowlist show a centred card that
  names the page and links to Setup.
- Data usage's router warnings and the Allowlist's Traffic Flow note link to the Setup step that fixes them.
- No polling while the page is in a background tab.

### Fixed
- Hover labels on the chart and the Allowlist bar no longer run off a phone screen.
- Keyboard focus is kept after switching UTC/Local, changing cycle, Discard, Save and Clear filters.
- Screen readers hear Setup's step states and the severity of each test result.
- Setup fields keep the same size next to a hint.

### Added
- Appstore screenshots (sample data).

## [0.8.0] - 2026-11-06

### Added
- **Setup** tab: checks for signalk-internet, generates a RouterOS script that is safe to run again (REST API,
  a plugin user that can only log in from this server, DNS options, Traffic Flow), tests the connection with
  plain-language errors, then saves your plan and starts the plugin.
- Opening the app lands on Setup until the plugin runs, on the Allowlist while metered, and on Data usage otherwise.
  Tab clicks, reloads and Back stay where you are.

### Changed
- Depends on [signalk-internet](https://github.com/meri-imperiumi/signalk-internet), so the Appstore installs it
  too, and the plugin is enabled by default.
- Without a router password the plugin waits quietly; router errors are explained in plain words and the plugin
  retries every minute.
- The plugin's settings page is called "MikroTik Data Meter".
- Every page has the same width; the Allowlist's filter column scrolls with the page.

## [0.7.5] - 2026-11-06

### Changed
- A Normal / Metered badge next to the app name shows the router's mode on every page.
- The Allowlist's filter column stays clear of the save bar.

## [0.7.4] - 2026-11-06

### Changed
- Allowlist: a filter and sort column (or a "Filter & sort" fold-out on phones) replaces the category pills.
  Sort by data, name, recently seen or days seen; filter by recently blocked, ads and tracking, and categories.

## [0.7.3] - 2026-11-06

### Added
- The app is called **MikroTik Data Meter** in Signal K, with a new logo (the Valve), favicon, app and
  home-screen icons.
- Pointing at a segment of the Allowlist's data bar names the service.

## [0.7.2] - 2026-11-06

### Changed
- Data usage: one chart for the billing cycle with a day's numbers on hover or tap, and a **Billing day** setting.
- Allowlist: one data bar (solid gets through, hatched is blocked) over a single list with a switch per service,
  and a save preview that estimates what allowing a service costs.
- A shared header with Auto / Night / Day; night mode without white or blue light.
- Router warnings include the RouterOS command that fixes them.

## [0.7.1] - 2026-11-05

### Added
- **Start counting from now** on the Allowlist: switch to metered, reset, and see what still uses data.
  The 14-day history stays.

## [0.7.0] - 2026-11-05

### Added
- Data volume per service and domain from the router's Traffic Flow export (NetFlow v9 / IPFIX, UDP port 2055).
- Night mode, following the vessel's `environment.mode` or set per device.
- Data usage shows days in the device's time zone, or in UTC to compare with Starlink.

### Changed
- Faster router sync: 636 entries added in 18.5 s, removed in 3.2 s, measured on a hAP ax S.

## [0.5.0] - 2026-11-05

### Added
- **Allowlist** page: the services and domains devices on board look up, grouped by
  [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community), with search over the whole
  catalog. Pick what gets through while metered.

### Removed
- The profile checkboxes in the plugin settings (the Allowlist page replaces them).

## [0.3.0] - 2026-11-03

### Added
- **Data usage** page: WAN data per day, split into normal and metered, with a cost estimate.
- Signal K paths `network.mikrotik.usage.today.{normal,metered}` and `network.mikrotik.usage.wan.{received,sent}`.

## [0.2.0] - 2026-11-03

### Changed
- Allowed hostnames are matched through the router's DNS, so devices and the firewall see the same addresses and
  signalk-internet's check no longer flips to offline while metered.
- Reinstalling keeps the plugin's rules below rules you placed above them.

## [0.1.0] - 2026-11-03

### Added
- Switches the MikroTik firewall to an allowlist while signalk-internet reports the connection as metered, and
  back when it's online again. Only router entries marked `signalk-mikrotik` are touched.

[Unreleased]: https://github.com/stigdreyer/signalk-mikrotik/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/stigdreyer/signalk-mikrotik/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/stigdreyer/signalk-mikrotik/releases/tag/v1.0.0
[0.1.0]: https://github.com/stigdreyer/signalk-mikrotik/commit/4abb632
[0.2.0]: https://github.com/stigdreyer/signalk-mikrotik/commit/7c4a4ca
[0.3.0]: https://github.com/stigdreyer/signalk-mikrotik/commit/afee3ca
[0.5.0]: https://github.com/stigdreyer/signalk-mikrotik/commit/775fdcc
[0.7.0]: https://github.com/stigdreyer/signalk-mikrotik/commit/427cf89
[0.7.1]: https://github.com/stigdreyer/signalk-mikrotik/commit/f7f74ae
[0.7.2]: https://github.com/stigdreyer/signalk-mikrotik/commit/478701d
[0.7.3]: https://github.com/stigdreyer/signalk-mikrotik/commit/a65e6ea
[0.7.4]: https://github.com/stigdreyer/signalk-mikrotik/commit/466274b
[0.7.5]: https://github.com/stigdreyer/signalk-mikrotik/commit/f046bcd
[0.8.0]: https://github.com/stigdreyer/signalk-mikrotik/commit/8b82476
[0.8.1]: https://github.com/stigdreyer/signalk-mikrotik/commit/2bb14da
