# Ironic API gaps

Endpoints this UI depends on that **do not exist in upstream Ironic today**. Each one has to be built on
the Ironic side — as a vendor passthru, a new REST resource, or an extension of an existing one — before
the corresponding feature works against a real deployment.

The remaining mocked endpoints below are answered only by the mock backend
(`packages/mock/src/backend.ts`) and the UI degrades to an explanatory empty state rather than an error.

**Status key:** `mocked` = contract designed, mock implements it, Ironic side not started.

| # | Endpoint | Purpose | Consumer | Status |
| --- | --- | --- | --- | --- |
| 4 | `GET /v1/nodes/{node}/logs` | List ramdisk/agent log archives the conductor collected | Logs tab | mocked |
| 5 | `GET /v1/nodes/{node}/logs/{log_id}` | Fetch the content of one log archive | Logs tab | mocked |
| 6 | `GET /v1/nodes/{node}/health` | Aggregated health: overall state plus BMC sensor readings | Health tab | mocked |
| 7 | `GET /v1/nodes/{node}/log_services` | Enumerate Redfish LogService resources (SEL, LC log) | Health tab | mocked |
| 8 | `GET /v1/nodes/{node}/log_services/{service_id}/entries` | Read entries from one LogService | Health tab | mocked |

## What already exists and is used as-is

For contrast — these are real and need no Ironic work:

| Endpoint | Microversion | Used for |
| --- | --- | --- |
| `GET /v1/nodes` | 1.0 (`detail`, `owner` later) | Fleet list |
| `GET /v1/nodes/{node}` | 1.0 | Node overview |
| `PUT /v1/nodes/{node}/maintenance` / `DELETE` | 1.0 | Maintenance |
| `PUT /v1/nodes/{node}/states/power` | 1.0 | Power operations |
| `GET /v1/nodes/{node}/history` | 1.78 | Logs tab (node history) |
| `GET /v1/nodes/{node}/inventory` | 1.81 | Inventory tab |
| `GET /v1/nodes/{node}/bios` | 1.40 | BIOS tab |
| `GET /v1/nodes/{node}/firmware` | 1.86 | Firmware tab |
| `PUT /v1/nodes/{node}/states/provision` (`target: service`) | 1.87 | Runbook execution |
| `GET /v1/runbooks` | 1.92, traits + description 1.112 | Runbooks tab |
| `GET`/`PUT /v1/nodes/{node}/states/console` | 1.0, graphical later | Console |
| `GET /v1/nodes/{node}/vendor_passthru/methods` | 1.0 | Per-node feature discovery |

---

## SupportAssist (downstream Ironic)

SupportAssist uses the implemented downstream `idrac` vendor interface, discovered per node through
`vendor_passthru/methods`. It is no longer a speculative history/download API.

```text
GET /v1/nodes/{node}/vendor_passthru/support_assist_get_eula_status
  -> {"accepted": true, "details": ...}

POST /v1/nodes/{node}/vendor_passthru/support_assist_collect
  body: {}
  -> 200 {"task_monitor": "/redfish/v1/.../Jobs/JID_123"}

GET /v1/nodes/{node}/vendor_passthru/get_job_status
  JSON body: {"task_monitor": "/redfish/v1/.../Jobs/JID_123"}
  -> {task_monitor, is_processing, task_state, task_status,
      percent_complete, messages, job_state}
```

NodeDash uses Ironic’s collection defaults (`HWData`, `filter_data: false`) and its configured upload
share. It displays EULA status without accepting license terms. An authorised operator must accept
Dell’s EULA separately if necessary, then refresh the status.

The browser sends `POST /api/nodes/{region}/{node}/support-assist/job`; the BFF sends a GET with a JSON
body to Ironic using Node’s HTTP client, because fetch forbids GET bodies. Automatic polling runs every
10 seconds while `is_processing` is true, stops on errors, and can be retried manually. Percentage alone
does not determine completion. The monitor remains in the page URL for bookmarking and reloads; an
operator can paste a monitor to resume polling. The BFF stores no jobs.

Collection history and browser downloads are out of scope. Operators still verify and retrieve the ZIP
through Kubernetes from the CDN SupportAssist volume. A completed job does not independently verify the
uploaded archive, and this UI introduces no retention or deletion policy.

To check the UI in mock mode, sign in, select a project, open an `idrac` node and its SupportAssist tab.
Check EULA status, choose **Collect bundle**, confirm the hardware collection, and watch it finish. Copy
the task monitor, leave the tab, return and paste it into **Resume a job**. The mock compresses collection
to 45 seconds. A full page reload resets the mock BMC; a real iDRAC retains its jobs independently.

## 4–5. Node logs (ramdisk / agent)

Ironic already collects deploy-ramdisk logs to `[agent] deploy_logs_local_path` or to object storage. There
is no way to list or read them over the API, so operators end up on the conductor host.

```text
GET /v1/nodes/{node}/logs
  -> {"logs": [{id, kind, collected_at, filename, size_bytes, source, truncated}]}

GET /v1/nodes/{node}/logs/{log_id}
  -> {"id": ..., "content": "...", "truncated": bool, "line_count": n}
```

- `kind` is the operation the logs came from: `deploy`, `clean`, `inspect`, `service`, `rescue`.
- `source` distinguishes `local` (conductor filesystem) from `swift`/`s3`.
- Content should be capped server-side with `truncated` set, so one enormous archive cannot be used to
  exhaust the API worker. The UI shows the truncation rather than pretending it has everything.
- Ordering newest-first matters: an operator debugging a failed deploy wants the last attempt.

## 6. Node health and sensors

Ironic reads BMC sensor data already, but only emits it to the message bus for Ceilometer. There is no way
to ask "is this machine healthy right now" over REST.

```text
GET /v1/nodes/{node}/health
  -> {"status": "ok|warning|critical|unknown",
      "collected_at": "...",
      "source": "redfish|ipmi",
      "checks": [{id, label, status, detail}],
      "sensors": [{name, type, reading, units, state,
                   threshold_warning, threshold_critical, physical_context}]}
```

- `status` is the worst of `checks` and `sensors`; the UI does not recompute it, so the conductor owns the
  rollup.
- `type` follows Redfish: `Temperature`, `Fan`, `Voltage`, `Current`, `Power`.
- `state` per sensor: `ok`, `warning`, `critical`, `absent`, `unknown`. `absent` matters — an empty PSU bay
  is not a fault, and the UI renders it differently.
- Readings should carry their thresholds. Without them the UI can show a number but not whether it is bad.
- This should be cached conductor-side with `collected_at` exposed. Polling a BMC per page view does not
  scale, and a stale reading presented as live is worse than a stale reading labelled as stale.

## 7–8. Redfish LogService

The BMC's own logs — Dell's SEL and Lifecycle Controller log — are the record of what the hardware thinks
went wrong. They are reachable over Redfish but not through Ironic.

```text
GET /v1/nodes/{node}/log_services
  -> {"log_services": [{id, name, description, entry_count, oldest_entry,
                        newest_entry, overwrite_policy, service_enabled}]}

GET /v1/nodes/{node}/log_services/{service_id}/entries?limit=&marker=&severity=
  -> {"entries": [{id, created, severity, message, message_id, entry_type,
                   sensor_type, resolved}], "next": marker|null}
```

- Service ids follow the BMC: Dell exposes `Sel` and `Lclog`.
- `severity` follows Redfish: `OK`, `Warning`, `Critical`.
- Paginate it. An LC log holds thousands of entries and the UI asks for a page at a time.
- `resolved` is a Dell OEM field. Where the BMC does not report it, omit rather than defaulting to false —
  the UI treats absence as unknown, not as unresolved.
- Read-only for now. Clearing a SEL is a destructive action we deliberately do not expose.

---

## Design principles these share

1. **Discoverability over version pinning.** Per-node features should be announced through
   `vendor_passthru/methods` or an equivalent, so the UI can gate on what a node can actually do rather
   than inferring from driver names.
2. **Server-owned rollups.** Where there is an overall status, the conductor computes it. Two clients
   deriving "healthy" from raw sensors will disagree.
3. **Say when the data was read.** Anything cached from a BMC needs `collected_at`.
4. **Cap and paginate.** Logs and entries are unbounded; every one of these returns a bounded page and says
   whether it truncated.
5. **Retention is part of the contract.** Anything that can hold customer data gets an expiry.
