# Env Console (`pcx`)

A dashboard and command-line tool for looking after Power Platform / Dataverse environments (DEV, TEST, UAT, PREPROD, PROD and so on) from one place.

It runs on your own machine. It signs in with the PowerShell session you already use (`Connect-AzAccount`), so no Entra app registration is needed.

**Works today**

- **Overview:** each environment's sign-in state, signed-in user, platform version, solution count, flows switched on and plugin steps switched on.
- **Installed solutions:** every solution across all environments, with versions. Filter by publisher, search, hide or show Microsoft solutions, and show only version differences.
- **Flows, business rules and plugin steps:** turn them on or off one at a time or in bulk. Managed environments need a reason for each change.
- **Activity:** a log of every change made through pcx (dashboard or CLI), with who, when and why.
- **CLI:** the same features as `pcx …` commands, for terminals and pipelines.

**Planned next** (designed, not built yet): solution compare (component-level diff), run history with flow and plugin errors, audit settings and audit log, and global user settings.

## Requirements

- Node.js 20 or later.
- One way to sign in:
  - **PowerShell (default):** PowerShell 7 (`pwsh`) with the `Az.Accounts` module (`Install-Module Az.Accounts -Scope CurrentUser`). On Windows, Windows PowerShell 5.1 also works.
  - **Azure CLI:** `az`. Set `"auth": { "provider": "azcli" }` in the config.
- A Dataverse security role in each environment that can read solutions and workflows. Turning flows, rules and plugin steps on or off needs System Customizer or System Administrator.

## Set up

```bash
cd env-console
npm install
npm run build
npm link            # optional: puts `pcx` on your PATH
```

Add your environments. DEV is unmanaged; every other environment is managed unless you say otherwise.

```bash
pcx env add DEV https://<org>-dev.crm11.dynamics.com --unmanaged
pcx env add TEST https://<org>-test.crm11.dynamics.com
pcx env add UAT https://<org>-uat.crm11.dynamics.com
pcx env add PREPROD https://<org>-preprod.crm11.dynamics.com
pcx env add PROD https://<org>.crm11.dynamics.com
```

Sign in, then check every environment:

```bash
pcx auth login            # opens the browser through Connect-AzAccount
pcx auth login --device-code   # for machines without a browser
pcx auth status
```

Start the dashboard:

```bash
pcx serve
```

Open the link it prints. The link carries a one-time key, and the dashboard only works through that link.

## How sign-in works

pcx never stores passwords or tokens on disk. When it needs to call an environment, it asks your existing sign-in for a short-lived token for that environment:

- **PowerShell:** `Get-AzAccessToken -ResourceUrl https://<org>.crm11.dynamics.com`, run in a child `pwsh` process.
- **Azure CLI:** `az account get-access-token --resource https://<org>.crm11.dynamics.com`.

Tokens are kept in memory and reused until five minutes before they expire. To sign in as someone else, run `Connect-AzAccount` again (or `pcx auth login`) and restart `pcx serve`.

Tokens are only requested for, and sent to, Dataverse hosts (`*.dynamics.com` and the sovereign-cloud equivalents). Any other URL is refused when you add the environment.

## Configuration

pcx reads `./pcx.config.json` if it exists, then `~/.pcx/config.json`, or the file named in the `PCX_CONFIG` variable. `pcx config path` shows which one is in use.

```json
{
  "tenantId": "contoso.onmicrosoft.com",
  "auth": { "provider": "azps" },
  "environments": [
    { "name": "DEV",  "url": "https://contoso-dev.crm11.dynamics.com", "managed": false },
    { "name": "PROD", "url": "https://contoso.crm11.dynamics.com",     "managed": true }
  ]
}
```

| Key | Notes |
|---|---|
| `tenantId` | Optional. A GUID or domain. If you leave it out, your default tenant is used. |
| `auth.provider` | `azps` (PowerShell, the default) or `azcli`. |
| `environments[].managed` | `true` means every change needs a reason. Defaults to `true`. |
| `allowedHostSuffixes` | Optional extra host endings for sovereign clouds, for example `[".crm.microsoftdynamics.us"]`. |

## Commands

```text
pcx auth login [--device-code]
pcx auth status
pcx env list [--json]
pcx env add <NAME> <URL> [--unmanaged]
pcx env remove <NAME>
pcx solution list [--env NAME]... [--publisher P]... [--include-microsoft] [--diff-only] [--search TEXT] [--json]
pcx flows|rules|plugins list --env NAME [--off] [--json]
pcx flows|rules|plugins on|off --env NAME (<name-or-id>... | --filter TEXT | --all) [--reason TEXT] [--dry-run] [--yes]
pcx serve [--port 4820]
pcx config path
```

Examples:

```bash
pcx solution list --publisher core --diff-only
pcx flows off --env UAT --filter "SAP" --reason "SAP outage INC-123" --dry-run
pcx flows off --env UAT --filter "SAP" --reason "SAP outage INC-123" --yes
pcx plugins on --env PROD AccountPreUpdate --reason "Fix deployed, CHG-456"
```

Rules for changes:

- In a managed environment, `--reason` is required.
- Changing more than one item in a managed environment also needs `--yes`.
- `--dry-run` shows what would change without changing it.

Exit codes: `0` success, `1` something failed (an environment, a change or sign-in), `2` usage error.

## Activity log

Every change is appended to `~/.pcx/actions.log` (one JSON object per line), or to the file named in `PCX_ACTION_LOG`. Each entry records the environment, the item, on or off, the reason, the signed-in user, CLI or dashboard, and the result. If Dataverse auditing is on, the change is also recorded there.

## Dashboard security

- It listens on `127.0.0.1` only.
- Every API call needs the random key from the link that `pcx serve` prints.
- Requests addressed to any other host name are refused, which blocks DNS-rebinding attacks.
- Changes from other websites are refused.
- The page has a strict Content Security Policy and builds everything with `textContent`, never HTML strings.
- Changes are only made to IDs that the server has just read back from that environment as the right kind of component.

## Development

```bash
npm test        # builds, then runs the node:test suites (no network; Dataverse and sign-in are faked)
npm run typecheck
```

Layout:

- `src/core`: config, sign-in providers, the Dataverse client, solutions, components and the activity log.
- `src/cli`: the `pcx` command.
- `src/server`: the local dashboard server.
- `public/`: the dashboard page (plain HTML, CSS and JavaScript; no build step).
- `test/`: the test suites.

### Notes and limits

- Turning a cloud flow on through Dataverse can fail if its connection references have no connection in that environment. The error from Dataverse is shown as it was returned.
- The "Microsoft solutions" filter is a best guess from the publisher name and prefix (`MicrosoftCorporation`, `msdyn`, `mspp` and so on).
- System solutions (`Default`, `Active`, `Basic`) are not listed.
