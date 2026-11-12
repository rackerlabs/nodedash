# nodedash

A web UI for hardware administration of OpenStack Ironic bare metal nodes: find a node across a large
fleet, see its real state, and carry out the hardware operations — maintenance, power, inventory, BIOS,
firmware, runbooks and console — from one place.

Operators sign in with federated identity through Keystone WebSSO, then pick a region. Keystone tokens are
kept in an encrypted, `HttpOnly` cookie that the page's JavaScript cannot read.

## Try it without a backend

```bash
npm install
```

```bash
npm run dev:mock
```

Then open <http://localhost:5173>. Everything is served by an in-browser mock of Keystone and Ironic, so no
OpenStack deployment, credentials or network access are involved. Sign-in is simulated.

The header has a **Mock** menu for switching scenarios, and `?scenario=<id>` selects one by URL:

| Scenario | What it shows |
| --- | --- |
| `default` | 240 nodes across 60 projects on a current Ironic (1.114) |
| `large` | 5,000 nodes and 4,000 projects — virtualized table and server-side project search |
| `empty` | A project with no nodes |
| `legacy` | Ironic 1.85: firmware, runbooks and the graphical console are hidden, not broken |
| `multi-region` | Three regions, so the region picker appears after sign-in (other scenarios have one) |
| `errors` | Reads fail intermittently and every mutation is rejected |
| `slow` | 2.5s latency on every call, for reviewing loading states |

Fixtures are generated from a fixed seed, so node names, UUIDs and links are identical on every run.

`npm run screenshots` writes a review set of PNGs to `./screenshots`.

## What it does

**Fleet view** (`/nodes`) — every node in the selected project with name, UUID, provision state, power
state, instance UUID, instance name, maintenance and maintenance reason. Sortable and searchable across all
of those; filter by provision state and maintenance. Rows are virtualized, so thousands of nodes stay
responsive.

**Project selection** — one command-palette dialog (⌘K anywhere) with fuzzy search over project name, id
and description, domain filters and recents. Ironic answers per project, so this drives everything below.

**Node pages** — each tab has its own URL, so any of them can be pasted into a ticket:

| URL | Contents |
| --- | --- |
| `/nodes/:uuid` | Power and provision state, the seven fleet fields, last error, driver, traits, properties |
| `/nodes/:uuid/inventory` | CPU, memory, system vendor, disks, NICs, plus the raw introspection payload |
| `/nodes/:uuid/bios` | Cached BIOS settings, searchable |
| `/nodes/:uuid/firmware` | Firmware components and versions |
| `/nodes/:uuid/runbooks` | Runbooks matching the node's traits, with a step preview before running |

**Actions** — set or clear maintenance with a required reason; power on, off and reboot (graceful offered
first, hard actions on a node running an instance need the node name typed out); run a runbook through the
`service` verb; enable a graphical console and open it in a new window.

**Shared links** — `/nodes/<uuid>` works with nothing selected. It tries the current project, then the one
remembered from last visit, then fans out across every project the user can see (bounded concurrency) and
selects whichever owns the node. Cold links normally land on the node with no clicks.

## Architecture

```text
apps/web    React + TypeScript SPA (Vite, Tailwind, TanStack Query/Table/Virtual)
apps/bff    Fastify backend-for-frontend: WebSSO, token handling, Ironic proxy
packages/shared   Types, zod schemas and domain rules used by both sides
packages/mock     Deterministic fixtures and a stateful fake backend
```

The BFF is not optional plumbing. It exists because:

- Keystone WebSSO finishes with a **form POST** from the IdP, which needs a server endpoint to receive it.
- Keystone and Ironic normally send no CORS headers, so a browser cannot call them directly.
- The Keystone token must not be readable by JavaScript. The BFF seals it into an encrypted `HttpOnly`
  cookie and adds it to upstream calls itself.

The BFF keeps no per-user state: the whole session travels in that cookie. Any replica can serve any
request, a restart signs nobody out, and there is no session store to run.

`packages/shared` holds every rule that both sides must agree on — microversion negotiation, the
`instance_name` resolver, runbook trait matching, power-confirmation rules — so the mock and the real path
cannot drift apart.

## Running against a real deployment

```bash
cp apps/bff/.env.example apps/bff/.env   # then edit it
npm run build                            # builds the SPA into apps/web/dist
STATIC_DIR=../web/dist npm start -w @nodedash/bff
```

For development against a live region, run the SPA and BFF separately — Vite proxies `/api` to
`http://127.0.0.1:8080` (override with `BFF_URL`):

```bash
npm run dev   # BFF (reads apps/bff/.env; set PUBLIC_URL=http://localhost:5173) and Vite together
```

Open `http://localhost:5173` — not `127.0.0.1` — so the origin matches the callback Keystone trusts.

### Container image

`Dockerfile` builds one image: the BFF serving the built SPA, so the page and `/api` share an origin. The
build stages carry npm and the dev toolchain; the runtime stage is distroless (no shell or package manager)
and runs as uid 65532 with a read-only root filesystem. Configure it with the same environment variables as
`apps/bff/.env.example`; `HOST`, `PORT` and `STATIC_DIR` are already set.

CI (`.github/workflows/ci.yml`) tests and builds it on every pull request, and pushes
`ghcr.io/rackerlabs/nodedash` with build provenance from `main` (tagged `main` and the commit sha) and from `v*`
tags. Deployments should pin the digest.

### Regions and the service catalog

After sign-in the user picks a region from `GET /v3/regions` (skipped when there is only one). When they
pick a project, the BFF scopes a token to it and takes the `baremetal` endpoint for that region from the
token's catalog, using the `IRONIC_INTERFACE` interface (`public` by default). A project with no Ironic in
the region is refused with a message saying so. Switching region drops the selected project; the UI then
re-selects the same project in the new region if it can.

Each region's Ironic negotiates its own microversion, so capabilities are per region.

### Keystone prerequisites

1. **Trust the callback.** Keystone refuses a WebSSO `origin` it does not know. Add the exact callback URL
   to `keystone.conf`:

   ```ini
   [federation]
   trusted_dashboard = https://your-host.example/api/auth/websso
   remote_id_attribute = <the attribute your IdP asserts>
   ```

   Restart Keystone after changing it. The BFF logs this URL at startup so it can be copied verbatim.

2. **Name your identity providers.** `IDENTITY_PROVIDERS` takes `id:protocol:label` entries; each becomes a
   button on the sign-in page. With none set, the UI offers the protocol-wide WebSSO endpoint using
   `WEBSSO_PROTOCOL`.

3. **Serve it over HTTPS.** Every cookie is `Secure` unless `COOKIE_SECURE=0`. Keystone's callback is a
   cross-site POST that carries no cookies, so the BFF parks the token and redirects to a same-site
   completion step that checks the sign-in state; no cookie needs `SameSite=None`. Locally, Chrome and
   Firefox accept `Secure` cookies on `http://localhost`; Safari needs `COOKIE_SECURE=0`.

4. **Regions are listable.** The region picker calls `GET /v3/regions` with the user's unscoped token.
   Keystone's default policy allows any authenticated user to list regions; check that yours does too.

5. **Project roles.** Users need a role on each project they administer; `GET /v3/auth/projects` is what
   populates the picker. Domain names are cosmetic — if a user holds no domain role, Keystone refuses to
   name the domain and the UI shows its id instead.

### Ironic requirements

The BFF asks Ironic for `x-openstack-ironic-api-maximum-version` and speaks the highest version both sides
understand. Features gate themselves off when the server is too old:

| Feature | Microversion |
| --- | --- |
| Node inventory | 1.81 |
| Firmware components | 1.86 |
| `service` provision verb | 1.87 |
| Runbooks | 1.92 |
| Runbook `traits` and `description` | 1.112 |
| Hardware identity on firmware components | 1.114 |

Before 1.112 a runbook had to be *named* after a trait the node carried; from 1.112 it declares its own
`traits`. The UI matches on whichever the server supports.

**Console.** Enabling a console returns the URL the UI opens. For a graphical console the node's
`console_interface` must be a graphical one (for example `redfish-graphical`) and `ironic-novncproxy` must
be running and reachable from the operator's browser — the UI opens that URL directly, it does not proxy
it. `GRAPHICAL_CONSOLE_TYPE` only needs setting where a node exposes both a serial and a graphical console.

> The `console_type` parameter and the exact `console_info` payload for the graphical console are not
> covered by the public API reference. The UI reads `console_info.url` and treats anything else as opaque.
> Confirm the shape against your own deployment the first time you use it.

## Security

- The session — the unscoped Keystone token, the current project's scoped token, identity, region and
  project — lives in one cookie, encrypted and authenticated with libsodium (`@fastify/secure-session`)
  under `SESSION_KEYS`. It is `HttpOnly`, `Secure` and `SameSite=Lax`, so page JavaScript cannot read it and
  the browser cannot alter it. Nothing sensitive is ever serialised into a response body.
- Anyone holding a copy of the cookie holds the session until the token expires. Signing out therefore
  revokes both tokens in Keystone rather than relying on the cookie being deleted.
- `SESSION_KEYS` decrypts every live session, so treat it like a credential. To rotate, put a new key
  first and drop the old one once `SESSION_TTL_HOURS` has passed; removing a key signs its sessions out.
- The BFF holds no per-user caches. Project lists and the cross-project node search are fetched fresh, and
  only the current project's scoped token is reused, from the cookie, until shortly before it expires. An
  unreadable expiry is treated as already expired.
- The session starts empty on every login, so nothing from before sign-in carries over.
- Every mutating `/api` request must echo a double-submit CSRF token. The WebSSO callback is exempt (Keystone
  cannot send the header) and is protected by a short-lived encrypted state cookie instead, which the
  callback tells the browser to drop once used.
- The BFF exposes an explicit list of Ironic endpoints. There is no open pass-through.
- Credential-shaped fields (`*_password`, `*_secret`, `*_token`, private keys) are stripped from responses
  before they leave the BFF, regardless of what the driver returned.
- Every state-changing action is audit-logged as structured JSON with the actor, IdP, project, node, action
  and outcome. Ship `audit: true` log lines wherever your audit trail lives.
- Post-login redirects are restricted to same-origin paths.
- Fixtures are synthetic. No real endpoints, tenant ids, credentials or node data belong in this repo.

**Before pointing this at production or customer-owned nodes, confirm with your team lead and Security.**

Tokens are decrypted in process memory for the length of a request. Protecting the heap is operational —
no `--inspect` in production, core dumps disabled, and no heap snapshots shipped to an APM or crash
reporter.

## Ironic API gaps

Several features here depend on Ironic endpoints that **do not exist upstream yet** — SupportAssist
collection, node logs, health and sensors, and the Redfish LogService passthrough. They are specified,
mocked and built in the UI ahead of the Ironic-side work.

**[docs/ironic-api-gaps.md](docs/ironic-api-gaps.md) is the authoritative list.** Keep it current: if you
add a feature that assumes an endpoint we have not built, it goes in that table.

Against a real deployment these endpoints 404 until the Ironic work lands, and the UI presents that as "not
available on this deployment" rather than as an error.

The mock compresses a SupportAssist collection from ~30 minutes to 45 seconds so it is walkable; the
`support-assist-realtime` scenario restores the real pacing.

## Mock fixture shape

Three domains, and the ownership model matters for what you see:

- **`infra`** holds the two projects that *own* hardware: `baremetal` (the Dell fleet, roughly three
  quarters of the nodes) and `netdev` (the non-Dell kit — HPE, Supermicro, and the only plain-IPMI nodes).
- **`sddc`** and **`rxdb`** hold tenant projects. They own nothing; they *lease* a subset of the nodes.

Ironic shows a node to both its owner and its lessee, with different rights, and the mock enforces the same
rule. So scoping to `baremetal` shows the whole Dell fleet, while scoping to a tenant shows only what has
been leased to it. The node overview marks whichever of owner/lessee is the project you are currently in.

Practically: **`infra/baremetal` is the project to start in** — it owns the Dell nodes, so it is the only
place SupportAssist is offered. Use `infra/netdev` to see the driver-unsupported paths.

### Known limits

**Copied cookies.** There is no server-side session to destroy, so a copied session cookie stays usable
until its Keystone tokens expire or are revoked. Sign-out revokes both tokens for that reason.

**Session lifetime.** The cookie's `SESSION_TTL_HOURS` is an upper bound only. A request is rejected as soon
as the underlying Keystone token expires — typically an hour — and there is no refresh or rolling idle
timeout, so operators re-authenticate on the Keystone token's schedule.

Get Security to review the token-handling design — Keystone tokens held in an encrypted client-side cookie —
before this handles production or customer-owned nodes.

## Development

```bash
npm run typecheck   # every workspace
npm test            # Vitest: domain rules, filters, ranking, redaction, mock backend
npm run test:e2e    # Playwright walkthrough against the mock backend
npm run build       # production SPA (no mock code or service worker is emitted)
```

The mock backend, its fixtures and MSW are excluded from a production build: the dynamic import is behind a
statically-replaced env check, and the service worker lives in `apps/web/public-mock`, which is only used
for mock builds.

## License

Copyright 2026 Rackspace Technology. Licensed under the [Apache License, Version 2.0](LICENSE).
