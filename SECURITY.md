# Security

MikroTik Data Meter holds a password for a router user and changes the router's firewall and DNS. If you find a
way to read that password, to make the plugin change router objects it didn't create, or to get past the allowlist
while metered, please report it privately: use **Report a vulnerability** on the repository's Security tab
(GitHub private vulnerability reporting), not a public issue.

Please include the plugin version, the RouterOS version and the steps to reproduce. You'll get an answer within a
week. Fixes go into the latest version only.

## How the plugin limits the damage

- The Setup script creates a router user whose group has only `read,write,api,rest-api` and that can only log in from
  the Signal K server's address; the REST service (`www-ssl`) is limited to the server's subnet.
- The plugin only changes router objects marked `signalk-mikrotik`.
- The password is stored in Signal K's plugin settings and is never returned by the plugin's HTTP routes.
- With Signal K's security on (2.31 or later), logged-in users can view the pages, users with read/write access can
  save the allowlist, and only admins can save settings, test a router login or remove the plugin from the router.
  With security off, anyone on the boat's network can do all of it.
