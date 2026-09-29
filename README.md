# SharePoint Metadata Grid (PCF)

A React virtual PCF control for model-driven forms (built for the contact form). It shows an editable grid of SharePoint document metadata for the record's folder. A configured SharePoint **view** decides the columns. You can:

- upload files by drag-and-drop or the Upload button
- edit metadata inline, including managed metadata and person columns
- delete files (they go to the recycle bin)
- work with whatever columns the view contains, with nothing hard-coded

- **Stack:** TypeScript, React 16.14 and Fluent UI v9 (platform libraries), `@azure/msal-browser` v4 (bundled), DOMPurify.
- **Tests:** Jest + ts-jest. All SharePoint, Graph and Dataverse I/O is mocked (`npm test`).

## Contents

- [Configuration](#configuration)
- [Authentication](#authentication)
- [Admin checklist (manual)](#admin-checklist-manual)
- [Phase 1 spike](#phase-1-spike-sitesselected)
- [How it works](#how-it-works)
- [Development](#development)
- [Before packaging / packaging](#before-packaging)
- [Design decisions and limitations](#design-decisions-and-limitations)

## Configuration

| Property | Type | Notes |
|---|---|---|
| `dummy` | bound, SingleLine.Text | Required by the manifest only. Bind any text column. |
| `clientId`, `tenantId` | input | Entra app registration (SPA). GUIDs, not secrets. |
| `viewName` | input, required | SharePoint view in the library. `__spike__` switches to the Phase 1 diagnostics panel. |
| `libraryName` | input | Filters document locations when there are several (library URL name or title). Also fills the `{library}` template token. |
| `siteUrl` | input | Absolute site URL. Filters locations; required by `template` mode. |
| `folderMode` | Enum | `documentLocation` (default), `template`, `override`. The mode the chain starts with (see below). |
| `fallbackTemplate` | input | e.g. `{library}/{contactnumber}` |
| `autoCreateFolder` | TwoOptions | Default off. Creates the template folder plus a `sharepointdocumentlocation` row. |
| `folderUrlOverride` | bound | Escape hatch: absolute folder URL. Checked against the host allowlist. |
| `columnConfig` | input, Multiple | JSON overrides (below). |

### columnConfig

Keys are field **internal names**. Anything not listed follows the SharePoint schema. Overrides can be stricter than SharePoint, never looser: `readOnly: false` cannot unlock a read-only column, and `requiredOnUpload: false` cannot relax a required one. Violations are ignored and shown as a dismissible configuration note.

```json
{
  "DocType":  { "requiredOnUpload": true, "label": "Type", "default": "Contract" },
  "Notes":    { "readOnly": true },
  "Legacy":   { "hidden": true },
  "Ref":      { "editor": "readonly" },
  "Summary":  { "editor": "textarea" }
}
```

`editor` accepts `readonly`, or an equivalent editor for the same type: `text`↔`textarea`, or `datetime`→`date`.

### Template tokens

| Token | Filled with |
|---|---|
| `{attribute}` | Any column logical name on the current record (read via `webAPI`) |
| `{attribute@formatted}` | That column's formatted value (lookups, option sets) |
| `{library}` | `libraryName` |
| `{recordid}` | Record GUID, lowercase with dashes |
| `{recordidN}` | Record GUID, uppercase without dashes |
| `{entityname}` | Record's table logical name |

Each token value becomes a single folder name: illegal characters are replaced and it can never add path segments. Empty tokens fail with a clear message. The result must be `library/folder[/…]`. The control does not assume the out-of-the-box `Name_GUID` format.

## Authentication

- **Client:** delegated public client (MSAL.js auth code flow with PKCE, SPA platform). No client secret, ever, and nothing sensitive in form configuration.
- **Redirect URI:** the D365 org URL (`context.page.getClientUrl()`).
- **Token flow:** `acquireTokenSilent` → `ssoSilent({ loginHint })` → `acquireTokenPopup`.
  - The popup is attempted at most once per failure.
  - After that, the control shows a **Sign in** button. It calls the popup from a user click, with no retry loop. `interaction_required` and `InteractionRequiredAuthError` re-prompt the same way.
  - A blocked popup gets its own state explaining how to allow popups for the org URL.
- **loginHint:** `context.userSettings.userName` is used when it is a UPN. In model-driven apps it is usually the display name, so the control falls back to `systemuser.domainname`.
- **MSAL instance:** one per control, created once. The cache is in `sessionStorage`.
- **Separate token per resource:**
  - SharePoint REST: `https://{tenant}.sharepoint.com/.default`, whatever delegated SharePoint permission was consented. Prefer **Sites.Selected**.
  - Graph term store: `https://graph.microsoft.com/TermStore.Read.All` only. The Graph site id is built from SharePoint REST ids (`{host},{siteId},{webId}`), so no Graph `Sites.*` permission is needed.
- **Host allowlist:** tokens only go to `https://*.sharepoint.com` (a single tenant label) and `https://graph.microsoft.com`.
  - Every configured or resolved URL is validated before a token is even acquired. That covers `siteUrl`, `folderUrlOverride`, document location URLs and `odata.nextLink`.
  - Paging links must also stay on the site's own host.
- **Logging:** tokens and auth responses are never logged. Everything that reaches the console or UI goes through `redact()`, and MSAL's own logger is disabled.

**MSAL version:** `@azure/msal-browser` is pinned to **v4**. v5 needs a "redirect bridge" script on the redirect page, and the D365 org URL cannot host one. v4 reads the popup response by polling the same-origin popup, which works with the org URL.

## Admin checklist (manual)

1. Create an app registration: **Single-page application** platform, redirect URI = the D365 org URL (e.g. `https://contoso.crm.dynamics.com`). Add `http://localhost:8181` too if you use the PCF test harness.
2. Add delegated permissions and grant admin consent:
   - SharePoint: **Sites.Selected** (preferred), or **AllSites.Write** as the fallback.
   - Microsoft Graph: **TermStore.Read.All**.
3. For Sites.Selected, grant the app access per site: `POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions` with `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<clientId>","displayName":"<name>"}}]}`. Users also need their own access to the site: delegated access is the intersection of the two.
4. Import the solution, add the control to the contact form and set its properties.
5. Users must allow popups for the D365 org URL.

## Phase 1 spike (Sites.Selected)

The spike proves that a delegated Sites.Selected token works against `_api` REST.

1. Set `viewName` to `__spike__`, plus `siteUrl` and `libraryName`, on a test form (or in the test harness).
2. **Run read checks** calls `GET /_api/web` and the list.
3. **Run read + write checks** also uploads a zero-byte `__pcf_spike_<guid>.txt` to the library root and recycles it.

Results show PASS/FAIL per step, without tokens. If the write fails with Sites.Selected but works with AllSites.Write, that is the documented fallback. No code changes are needed, because the SharePoint scope is `/.default`.

## How it works

```
src/
  index.ts                  PCF entry: one services instance (one MSAL instance) per control
  services/
    auth/                   MSAL wrapper, token scopes, host allowlist, redaction
    httpClient.ts           Bearer fetch: allowlist first, Retry-After/backoff, typed errors
    sharepoint/             REST client, lists/views/fields/content types, items, upload, pickers, spike
    graph/                  term store client + per-session cache
    dataverse/              folder resolver (documentLocation / template / override)
    gridLoader.ts           resolve -> verify -> schema -> columns
  model/                    field schema, column model, editor registry, values/serialisation, validation, upload plan
  config/                   columnConfig parser
  components/               App, GridView, MetadataGrid, editors, UploadDialog, DeleteDialog, DropZone, status views
  utils/                    filename validation, collision naming, retry, errors
tests/                      Jest, all I/O mocked
```

### Folder resolution

Folders are read, never guessed. The chain starts at `folderMode`, continues through the other modes in the order documentLocation → template → override, and stops at the first folder that **exists** (checked with `GetFolderByServerRelativePath`).

- **documentLocation:**
  - Reads `sharepointdocumentlocation` where `_regardingobjectid_value` is the record and the location is active.
  - Walks `_parentsiteorlocation_value` up to the `sharepointsite` for the absolute URL.
  - If the walk fails, it uses `RetrieveAbsoluteAndSiteCollectionUrl` as a shortcut, then `SP.Web.GetWebUrlFromPageUrl` to find the web.
  - With several locations, it applies the library/site filter, else takes the default site first, else the oldest. A location picker appears whenever there is more than one.
- **template:** builds the path from `fallbackTemplate` and `siteUrl`.
- **override:** uses `folderUrlOverride`.

If nothing resolves, the grid shows **Folder not found** with what was tried.

**Auto-create:** with `autoCreateFolder` on and a template folder that does not exist yet, the control creates the folder segments and writes a matching `sharepointdocumentlocation` row. It reuses or creates the library location under the matching `sharepointsite`.

Auth, permission, allowlist, throttling and network errors are never treated as "try the next mode".

### Grid

- **Columns:** built from the view's `ViewFields` in view order, with aliases such as `LinkFilename` → `FileLeafRef`.
- **Data:** `RenderListDataAsStream` with the view's CAML and `FolderServerRelativeUrl`.
  - Files only, including subfolders of the record's folder (`Scope="Recursive"`).
  - Paging uses the `NextHref`/`PrevHref` tokens.
  - Sort and filter rewrite the ViewXml (`OrderBy Override`, `And`-nested `Where`), never client-side.
- **Display vs edit values:** display values come from render data. Edit values come from the raw schema (`items(id)`, with user `Name` claims expanded). Lookups and terms come from render data, because REST returns WssIds instead of labels.
- **Dates:** converted exactly to site time with `RegionalSettings/TimeZone/utcToLocalTime`.
- **Rich text:** sanitised with DOMPurify before rendering.
- **Theming:** the app theme comes from `context.fluentDesignLanguage`, and all colours use Fluent tokens.

### Editors

| SharePoint type | Editor | Written as |
|---|---|---|
| Text | Input (MaxLength) | string, `""` to clear (never null) |
| Note | Textarea. Rich text / append-only are read-only | string |
| Choice / MultiChoice | Dropdown, or Combobox if fill-in is allowed | `A` / `A;#B` |
| Number / Currency | numeric, schema min/max | site decimal separator |
| DateTime | `date` / `datetime-local` (DisplayFormat), in site time | site date format (`RegionalSettings`) |
| Boolean | Checkbox | `1` / `0` |
| Lookup(Multi) | searchable, paged picker on the target list | `3` / `1;#;#2;#` |
| User(Multi) | people picker (`clientPeoplePickerSearchUser`) | `[{"Key":"i:0#.f\|membership\|upn"}]` |
| Taxonomy(Multi) | term picker (Graph term store, anchor-aware) | `Label\|guid;Label\|guid` |
| URL | url + description | `url, description` (commas doubled) |
| File name | Input, extension kept, filename rules | `FileLeafRef` |
| Anything else | read-only text; the type is logged once | never written |

Read-only, system and calculated columns render but never enter edit mode.

### Saving

- Dirty rows are highlighted. A save/discard bar appears, and paging, sort and filter pause until you save or discard.
- Only changed fields are sent: one `validateUpdateListItem` per row.
- **Per-field errors:** that call returns HTTP 200 even when a field fails. Each `HasException`/`ErrorMessage` in the result array is shown on the specific cell.

### Upload

1. **Pre-upload dialog:**
   - Content type picker when there are several.
   - Every required, editable field of that content type (not just view columns), plus `requiredOnUpload`. Filled per file or with "apply to all".
   - Editable file names with filename validation.
   - **Upload** stays disabled until everything is valid.
2. **Collision check:** against the live folder listing and within the batch, re-checked at upload time.
   - **Replace:** warns if versioning is off.
   - **Rename:** prefilled `name (1).ext`, with live validation.
   - **Skip.**
   - Any choice can be applied to all conflicts.
3. **Upload:** `AddUsingPath` below 250 MB, chunked `StartUpload`/`ContinueUpload`/`FinishUpload` above that, with per-file progress.
4. **Metadata:** `validateUpdateListItem(bNewDocumentUpdate: true, checkInComment)` sets metadata and checks the file in, so no file is left in checked-out limbo.
5. **On failure:**
   - A **new** file is recycled.
   - A **replaced** file is never deleted: if our upload left it checked out, the checkout is undone, which restores the previous version.

### Delete

Row action → confirmation → `items(id)/recycle()`. The file can be restored from the recycle bin.

### Error states

The control shows a distinct state for each of these:

- not configured
- sign-in required
- popup blocked
- cancelled
- folder not found
- no permission (the message mentions the Sites.Selected grant)
- throttled
- network error

For throttling, 429/503/504 honour `Retry-After` (seconds or HTTP date), otherwise use exponential backoff with jitter, up to 5 attempts.

## Development

```bash
npm install
npm test            # Jest, all I/O mocked
npm run lint:all    # ESLint (typescript-eslint, react, react-hooks, Power Apps checker rules)
npm run typecheck   # refreshes generated manifest types, then tsc
npm run build       # pcf-scripts (also runs lint)
npm start           # PCF test harness (http://localhost:8181; register it as an extra SPA redirect URI)
```

## Before packaging

- The control namespace in `src/ControlManifest.Input.xml` is `PLACEHOLDER`. Set the real namespace/publisher prefix first.
- The packaging script refuses to run while it is still `PLACEHOLDER`.

## Packaging

Requires the Power Platform CLI (`pac`) and the .NET SDK.

```bash
scripts/package.sh "<Publisher Name>" <prefix> [Managed|Unmanaged|Both]
```

The script runs `npm ci`, the tests and a production build. It then runs `pac solution init` and `pac solution add-reference` (first run only) and `dotnet build`. The zips land in `Solution/bin/Release/`.

## Design decisions and limitations

- **Popup blockers** are an accepted limitation. The popup is only auto-attempted once, then needs a click.
- **Dates** are edited in the **site's** time zone, which is how `validateUpdateListItem` parses them. The editor tooltip says so.
- **Recursive scope:** the grid lists files in the record's folder and its subfolders. Uploads go to the record's folder.
- **Upload progress:** uploads below 250 MB use a single request, so their progress bar only shows start and end. Chunked uploads report per chunk.
- **Large term sets:** the term picker walks at most 2000 terms / 6 levels per set, cached per session. Search covers what was loaded.
- **Lookups** to lists in another web are not supported (the current web is assumed).
- `AddUsingPath` / `GetFolderByServerRelativePath` / `GetFileByServerRelativePath` are used instead of `Files/add` and `folders/getbyurl`. They are the same operations, but safe for `#`, `%` and quotes in names.
