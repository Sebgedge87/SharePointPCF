# Env Console (`pcx`)

A dashboard and command-line tool for looking after Power Platform / Dataverse environments (DEV, TEST, UAT, PREPROD, PROD and so on) from one place.

It runs in one of two ways:

- **On your own machine:** it signs in with the PowerShell session you already use (`Connect-AzAccount`), so no Entra app registration is needed.
- **Hosted for your team** (Azure App Service): everyone signs in with their own Microsoft account. Dataverse is called as that person, so their security roles decide what they can do. See [Hosting for a team](#hosting-for-a-team).

**Works today**

- **Overview:** each environment's sign-in state, signed-in user, platform version, solution count, flows switched on and plugin steps switched on.
- **Installed solutions:** every solution across all environments, with versions. Filter by publisher, search, hide or show Microsoft solutions, and show only version differences.
- **Flows, business rules and plugin steps:** turn them on or off one at a time or in bulk. Managed environments need a reason for each change.
- **Activity:** a log of every change made through pcx (dashboard or CLI), with who, when and why.
- **CLI:** the same features as `pcx …` commands, for terminals and pipelines.

- **Solution compare:** one solution between two environments, component by component. It shows what is missing, what differs (with a line-by-line diff of forms, views, flows, web resources, plugin steps and environment variables), and what was changed directly in a managed environment.
- **Run history:** cloud flow runs and plugin errors per environment, with daily charts, failure rates, the components that fail most, and each run's error, trace and Power Automate link. You can switch plugin trace logging on or off.
- **Audit:** system, table and column auditing, switched on or off one at a time or in bulk, plus who changed what (old and new values).
- **User settings:** set regional formats, time zone, language and records per page for all users, or for a security role, team or business unit. It can keep users' own changes and set the defaults for new users.
- **One column per environment:** Flows & plugins, Run history, Background jobs, Audit, Security, Connections & variables and User settings show every environment side by side. Switch a single cell, or tick rows and choose which environments to change.
- **Alerts:** problems across every environment in the last 24 hours (unreachable environments, flow and plugin failures, failed or stuck background jobs, variables without a value, connection references without a connection, auditing or tracing switched off). `pcx alerts run --post` sends new ones to a Teams channel, and `pcx alerts schedule --install` runs that on a schedule.
- **Health report:** a downloadable HTML report (print it to PDF if needed) or CSV, covering health per environment, alerts and solution drift. Use `pcx report` from the command line.
- **Background jobs:** failed, suspended, long-waiting and long-running system jobs, with bulk cancel and resume.
- **Security:** users and their roles (direct and through teams) in every environment, users with no roles, which roles exist where, and a privilege-by-privilege comparison of a role.
- **Connections & variables:** environment variable values in every environment (edit them in place; secrets are never shown) and whether each connection reference has a connection.
- **Real environment names:** environments show their Dataverse display name everywhere (picked up automatically, or from the environment lookup, and editable under Manage environments). Each also has a short name, such as `UAT`, for `pcx --env`.
- **CLI page:** a terminal in the dashboard that runs `pcx` commands (on your own machine only), next to a reference of every command with examples you can click to use.
- **Remove unmanaged changes:** from Solution compare, with a reason and confirmation.
- **Microsoft and system items** are hidden by default on Flows & plugins; one switch shows them.
- **Brand and themes:** FormusPro navy and magenta with Rubik and IBM Plex Sans, in a light theme and a dark theme (Light / Dark / follow the system).

## Requirements

- Node.js 20 or later.
- One way to sign in:
  - **PowerShell (default):** PowerShell 7 (`pwsh`) with the `Az.Accounts` module (`Install-Module Az.Accounts -Scope CurrentUser`). On Windows, Windows PowerShell 5.1 also works.
  - **Azure CLI:** `az`. Set `"auth": { "provider": "azcli" }` in the config.
- A Dataverse security role in each environment that can read solutions and workflows. Turning flows, rules and plugin steps on or off needs System Customizer or System Administrator.

## Set up in one step (Windows)

`setup.ps1` does everything:
1. installs Node.js, PowerShell 7, git and Az.Accounts if they are missing;
2. downloads or updates the code and builds it;
3. asks for your environment URLs;
4. signs you in;
5. opens the dashboard.

Run it again at any time to update.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

You can also pass everything up front:

```powershell
.\setup.ps1 -Dev https://contoso-dev.crm11.dynamics.com -Uat https://contoso-uat.crm11.dynamics.com -Prod https://contoso.crm11.dynamics.com -TenantId contoso.onmicrosoft.com
```

Other switches: `-DeviceCode` (sign in without a browser), `-NoDashboard`, `-NonInteractive`, and `-InstallPath` (where the code goes; default `~\pcx`).

After setup, start the dashboard with `pcx serve --open`.

## Set up by hand

```bash
cd env-console
npm install
npm run build
npm link            # optional: puts `pcx` on your PATH
```

Without `npm link`, run it from the `env-console` folder as `.\pcx env list` (PowerShell or cmd) or `node dist/src/cli/index.js env list`. Running `node env list` does not work: Node treats `env` as a file name.

Add your environments. The easiest way is the dashboard: Overview › Manage environments › **Find my environments** lists every environment your account can reach (from Microsoft's Global Discovery Service), suggests short names, and adds the ones you tick. From the terminal, `pcx env discover` lists them.

Or add them by URL. DEV is unmanaged; every other environment is managed unless you say otherwise.

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
pcx serve [--port 4820] [--open]
pcx config set tenant <id-or-domain>
pcx config set provider azps|azcli
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

## Hosting for a team

In hosted mode the site uses Entra ID sign-in (authorization code with PKCE). Each person's sign-in is exchanged for a token for each Dataverse environment, and every call runs as that person:

- They only see and change what their Dataverse security roles allow.
- Dataverse auditing records the real person, and the site's Activity page records who, what and why.
- Only the users and groups you assign to the app can sign in ("Assignment required").

### Deploy with one script

You need:
- PowerShell 7;
- the Azure CLI (`az`), signed in to the subscription the site should live in;
- a Global, Application or Cloud Application Administrator, for the one-time admin consent. If you are not one, the script prints a link to send to an admin.

```powershell
pwsh ./deploy/deploy-azure.ps1 -AppName pcx-contoso -AllowedGroup "Power Platform Admins"
```

The script:
1. builds the app;
2. creates the Entra app registration (redirect URI, the delegated permission `Dynamics CRM / user_impersonation`, admin consent, assignment required, and a client secret);
3. creates the resource group, a Linux App Service plan (B1) and the web app (Node 22, HTTPS only, Always On);
4. stores the settings;
5. deploys the code.

Environments come from `-Dev/-Test/-Uat/-PreProd/-Prod`, or from your local pcx config if you ran `setup.ps1`. Run the script again to redeploy. Add `-RotateSecret` to issue a new client secret.

Each person also needs a user record in every environment they will use, as they would for the maker portal.

### App settings (if you deploy another way)

| Setting | Value |
|---|---|
| `PCX_MODE` | `hosted` |
| `PCX_TENANT_ID` | Tenant ID |
| `PCX_CLIENT_ID` | App registration's Application (client) ID |
| `PCX_CLIENT_SECRET` | Client secret (better: a Key Vault reference) |
| `PCX_PUBLIC_URL` | `https://<app>.azurewebsites.net` (the redirect URI is this plus `/auth/callback`) |
| `PCX_SESSION_SECRET` | 32+ random characters |
| `PCX_ENVIRONMENTS` | `[{"name":"DEV","url":"https://…","managed":false},{"name":"PROD","url":"https://…"}]` |
| `PCX_ACTION_LOG` | `/home/pcx/actions.log` (kept across restarts on App Service) |
| `PCX_REQUIRED_ROLE` | Optional: an app role users must hold |
| `PCX_SESSION_IDLE_MINUTES` | Optional, default 480 |

Start command: `node dist/src/cli/index.js serve`. Health check path: `/healthz`.

### Limits of this first hosted version

- Sign-in sessions are kept in memory. Restarting the app signs everyone out, and it should run as one instance (B1 does). Shared sessions would be needed to scale out.
- The activity log is a file on the app's shared storage. Moving it to a Dataverse or Azure table is a planned improvement.
- The client secret sits in app settings. A Key Vault reference, or a managed identity with federated credentials, is the stronger option.

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
