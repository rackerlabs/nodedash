# SupportAssist archive downloads

The SupportAssist tab lists the selected node's archives, newest first, with modification times and
sizes. **Download** streams the ZIP through NodeDash without buffering the whole file in memory.
Storage credentials stay in the BFF; the browser uses its existing NodeDash session.

Each list and download request calls Ironic's node vendor-method discovery endpoint with the user's
project-scoped token. That endpoint enforces `baremetal:node:vendor_passthru`. NodeDash does not duplicate
role or ownership rules. Node visibility alone does not grant download access.

The BFF lists only the selected Ironic node's `<node_uuid>/` directory beneath the configured archive
URL. Configure Ironic's `[drac]support_assist_share_url` with a trailing `/{node_uuid}/`, for example
`http://192.0.2.10/supportassist/{node_uuid}/`. Neither collection nor archive access requires inspection
data. There is no fallback to serial directories or old flat-directory archives; a missing node
directory shows an empty list. A re-enrolled node has a new UUID and a separate archive directory.
Downloads use that same UUID directory and accept only filenames matching
`TSR<14 digits>_<service tag>.zip`. iDRAC keeps its original filename; the service tag is not used to
identify the node or authorize access. This format was verified on iDRAC 9. Other
filename formats are not listed. Archives are not mapped to jobs: Ironic returns a task monitor but no
archive filename. **Modified** is the stored file's modification time, not a verified collection time.

## Deployment setup

1. In each regional CDN namespace, provision a Secret named `supportassist-download-auth` with a key
   `htpasswd`. Its value is an NGINX-compatible password-file entry for a dedicated NodeDash reader.
   Keep the original reader password in the secret manager for the BFF; do not commit either value.
2. Enable the CDN's protected read location using its existing SupportAssist volume:

   ```yaml
   supportassist:
     enabled: true
     downloadSecretName: supportassist-download-auth
   ```

   Deploy the updated CDN chart. The existing HTTPS CDN hostname must route `/supportassist-archives/`
   to its normal firmware listener (Service port 80). The internal PUT listener remains separate.
   If firmware is also exposed through an internal HTTP gateway, add an archive-specific HTTPS
   redirect there; archive reads must not reach Basic authentication over that HTTP route.
   Anonymous HTTPS reads must return 401. The reader permits listing and file reads, not writes or deletion.
3. In the NodeDash namespace, provision a Secret named `nodedash-supportassist` with a key
   `SUPPORT_ASSIST_ARCHIVES`. The value is a JSON map keyed by the exact Keystone region name:

   ```json
   {"north1":{"url":"https://cdn.north1.example.com/supportassist-archives/","username":"nodedash-reader","password":"<reader password>"}}
   ```

   The URL must use HTTPS with a certificate trusted by the BFF. The username and password must match
   the CDN password-file entry. NodeDash follows no redirects. Add other regions only when configured.
4. Use the existing NodeDash chart's `extraEnv` setting to inject the Secret into a new NodeDash image:

   ```yaml
   extraEnv:
     - name: SUPPORT_ASSIST_ARCHIVES
       valueFrom:
         secretKeyRef:
           name: nodedash-supportassist
           key: SUPPORT_ASSIST_ARCHIVES
   ```

   Deploy the CDN and verify authentication before rolling out NodeDash. A region absent from the map
   reports that downloads are not configured. Collection and polling continue independently.

## Verification

- With vendor passthru permission, open an iDRAC node's SupportAssist tab and refresh archives.
- Check filenames, modification times and sizes. Another node's UUID directory must not be accessed.
- Verify collection, listing and downloads work when inspection data is unavailable.
- Confirm storage requests use only `<node_uuid>/` and `<node_uuid>/<filename>`. Old flat-directory
  archives must not appear; a node without its own directory must show an empty list.
- Start a fresh collection and check that the archive list refreshes on completion without a click.
  Keep manual refresh available if the ZIP is not visible yet.
- Download the expected ZIP and run `unzip -t <filename>.zip`. Job completion alone does not verify it.
- Remove vendor passthru permission and check that both listing and a saved direct download URL fail.
- An unauthenticated browser must not receive an archive; another node's filename must return 404.
- During a large download, cancel the browser transfer and check that the upstream connection closes.
- Check download audit events: `requested`, then `succeeded` when the server finishes sending, or
  `failed` on storage errors or interrupted transfers. Success does not prove the browser saved the ZIP.

Only directory metadata is collected in BFF memory. ZIP bytes stream with backpressure, and disconnects
close the upstream stream. Neither path is cached. Files remain on the dedicated PVC; retention,
archiving, deletion and automatic submission to Dell are outside this change.

Mock mode supports archive metadata and mocked fetch responses. MSW skips native download navigation;
the browser test checks the link and fetches the mock ZIP, while BFF tests exercise native HTTP
attachments and streaming. Verify the complete real download through the deployed BFF and CDN.
