# Secure local HTTPS deployment

Caddy 2.11.7 terminates TLS using a private local CA and proxies to the Next.js container over the private Docker network. The HTTPS overlay removes the app's host HTTP mapping, forces COOKIE_SECURE=true and derives APP_ORIGIN from the exact configured HTTPS host/port. Caddy supplies the forwarded scheme/host information and ignores untrusted client forwarding values by default. Existing exact-origin mutation checks remain unchanged. PostgreSQL has no host port. Only TCP HTTPS is published; public ACME, HTTP redirects, public tunnels and router forwarding are not configured.

## Setup

```sh
node scripts/configure.mjs
node scripts/ops.mjs init
```

The environment initializer preserves existing files; if already configured, use the existing `.env`. In `.local/operations.env`, set LAN_HOST to the Mac's reserved private IPv4 address, APP_BIND_IP to that same private interface and HTTPS_PORT=443. A stable local DNS/mDNS name such as `taky.local` may be used for LAN_HOST if every intended device resolves it to the private host. The wrapper rejects public bind addresses. Never bind a public interface or configure router port forwarding/UPnP.

```sh
node scripts/ops.mjs up
node scripts/ops.mjs ps
node scripts/ops.mjs export-ca
```

These commands use the base, operations and HTTPS Compose files and the private operations environment. Use the wrapper consistently; `docker compose up` with only the old base file can restore its development HTTP mapping. Docker Compose 2.24.4+ is required for `!reset []`. Docker Desktop must be running. On macOS, permit Docker Desktop in the firewall for the intended private network, keep the firewall enabled and avoid guest Wi-Fi client isolation. No firewall setting is modified automatically by these scripts.

Before owner admin setup, establish certificate trust as below. Then run `docker compose --env-file .env --env-file .local/operations.env -f docker-compose.yml -f docker-compose.operations.yml -f docker-compose.https.yml exec app node node_modules/tsx/dist/cli.mjs scripts/admin.ts` from a private terminal. The first-admin CLI still requires an owner-selected password and never creates a default account. Existing accounts remain unchanged. Open `https://<LAN_HOST>/login/`, authenticate and verify that the session cookie is Secure, HttpOnly and SameSite=Strict. Only the exact HTTPS origin may send mutations. A plain HTTP alias or another hostname deliberately fails origin checks.

## Trust the public CA certificate

`export-ca` copies only `.local/certificates/root.crt`. The CA private key remains in the named `caddy_data` volume. Never copy or distribute the private key. Confirm the root certificate's SHA-256 fingerprint directly on the host:

```sh
openssl x509 -in .local/certificates/root.crt -noout -sha256 -fingerprint
curl --cacert .local/certificates/root.crt https://<LAN_HOST>/api/health/
```

Replace the placeholder with the configured private address/name. `--cacert` validates the chain and requested host using this specific trusted root. Do not use `-k`, `--insecure`, `NODE_TLS_REJECT_UNAUTHORIZED=0` or browser certificate-error bypasses.

On the hosting Mac and a second Mac, import the verified public root into Keychain Access, select the intended system/login keychain, open that certificate and set SSL trust to Always Trust after checking its fingerprint. macOS may require owner authentication. Quit/reopen the browser. An owner may instead use `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain .local/certificates/root.crt` after inspecting the certificate. The project does not silently alter the system trust store.

On iPhone/iPad, transfer the public `.crt` over a trusted channel after checking its fingerprint on the Mac. Open the certificate/profile, then Settings → General → VPN & Device Management and install the downloaded profile. Next open Settings → General → About → Certificate Trust Settings and enable full trust for this specific root. Reopen Safari at the exact HTTPS address. Menu wording may vary with OS version or management policy; managed devices may require their administrator. Never install an unverified certificate received from an unknown source.

On Android, use Settings → Security/Privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate, checking the same fingerprint. Browser/managed-device policies may require separate trust administration. On Windows, import the public root into the intended Trusted Root Certification Authorities store and verify its fingerprint. Remove the trust entry if the server/CA is retired or compromised.

Do not report another device as commissioned until its browser shows a valid certificate without warnings, can log in, displays all 15 rooms, can perform a role-authorized edit and rejects an unauthorized mutation. Access from a physical second device is not covered by an automated loopback TLS test.

## IP changes and certificate persistence

Reserve the private address in your router. The previous Phase 2 verification encountered an actual DHCP address change, which caused Docker's private bind to fail. If it changes, find the assigned address in macOS Wi-Fi TCP/IP settings or `ifconfig en0`, update APP_BIND_IP and LAN_HOST in `.local/operations.env` and run `node scripts/ops.mjs reload`. The overlay updates the canonical application origin and Caddy obtains a matching local certificate. A stable `.local` name can avoid changing the browser address, but its resolution must be tested on each device.

The root CA persists in a named volume across container restarts and IP certificate renewal. An existing trusted root therefore need not be replaced after a leaf certificate renewal. If the Caddy data volume is lost, export and commission the new root, remove the retired root from devices and verify the new fingerprint. Backups intentionally do not place a CA private key alongside encrypted database archives.

## Checks and troubleshooting

```sh
node scripts/ops.mjs ps
node scripts/ops.mjs export-ca
curl --cacert .local/certificates/root.crt https://<LAN_HOST>/api/health/
```

- Certificate not trusted: compare fingerprints and complete trust installation. Do not weaken TLS validation.
- Name mismatch: use the exact LAN_HOST, recreate the proxy and check DNS/private IP configuration.
- Login succeeds but no cookie: confirm the HTTPS overlay is active and the browser is using HTTPS. Secure cookies are not a reason to revert to HTTP.
- Saves return 403: compare browser Origin with the configured HTTPS origin. Keep one canonical name; do not add permissive CORS or disable origin checks.
- Bind fails: the configured private IP is no longer assigned or the port is occupied. Correct the address/port rather than exposing all interfaces.
- Proxy unhealthy: inspect Caddy configuration and app readiness. Its administration API is bound only inside its container and is not published.
- Device cannot connect: verify same private network, macOS firewall, private DNS and router client isolation. Do not resolve it with a public tunnel.

Implementation follows [Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https) and [internal issuer configuration](https://caddyserver.com/docs/caddyfile/directives/tls). Apple documents [manual certificate trust on iOS](https://support.apple.com/en-us/102390) and [Keychain trust on macOS](https://support.apple.com/guide/keychain-access/change-the-trust-settings-of-a-certificate-kyca11871/mac). Trust on additional physical devices requires owner verification and must be recorded separately.
