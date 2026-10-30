# Env Console user guide

Env Console (pcx) lets you look after several Power Platform environments in one place: DEV, TEST, UAT, PRE-PROD, PROD and any others. It reads each environment as **you**, with your own security roles, and puts them side by side so you can see what differs and change things safely.

It comes in two parts that do the same things:

- **The dashboard:** a web page that runs on your own machine (`pcx serve`), or on a site your team hosts.
- **The CLI:** the `pcx` command, for PowerShell and scripts.

This guide covers both. In the dashboard you can open it any time from **Help** in the menu, or from the **?** next to each page title.

## Contents

- [Getting started](#getting-started)
- [Signing in](#signing-in)
- [Choosing environments](#choosing-environments)
- [Safety: reasons, roles and confirmations](#safety-reasons-roles-and-confirmations)
- [Overview page](#overview-page)
- [Alerts page](#alerts-page)
- [Installed solutions page](#installed-solutions-page)
- [Solution compare page](#solution-compare-page)
- [Connections and variables page](#connections-and-variables-page)
- [Flows, business rules and plugins page](#flows-business-rules-and-plugins-page)
- [Run history page](#run-history-page)
- [Background jobs page](#background-jobs-page)
- [Audit page](#audit-page)
- [Security page](#security-page)
- [User settings page](#user-settings-page)
- [Activity page](#activity-page)
- [CLI page](#cli-page)
- [Creating environments](#creating-environments)
- [Reports](#reports)
- [Themes and display](#themes-and-display)
- [Command reference](#command-reference)
- [Configuration file](#configuration-file)
- [Hosting for a team](#hosting-for-a-team)
- [Troubleshooting](#troubleshooting)
- [Glossary](#glossary)

## Getting started

### What you need

- Windows 10 or 11 (macOS and Linux work too, by hand).
- **PowerShell 7** (`pwsh`). Windows PowerShell 5.1 is not enough. Install it with `winget install Microsoft.PowerShell`.
- **Node.js 20 or later** and **Git**. The setup script installs them for you.
- A work account that can sign in to your Power Platform environments.

### Set up in one step

1. Download `setup.ps1` from the `env-console` folder of the repository.
2. Open **PowerShell 7** (search for "PowerShell 7" in the Start menu, not "Windows PowerShell").
3. Run it:

```powershell
pwsh -ExecutionPolicy Bypass -File .\setup.ps1
```

The script:

1. Installs Node.js, Git and the Az.Accounts PowerShell module if they're missing.
2. Downloads the console to `%USERPROFILE%\pcx` (or updates it), builds it, and adds the `pcx` command.
3. Signs you in (see [Signing in](#signing-in)).
4. Opens the dashboard in your browser.

Useful options:

| Option | What it does |
|---|---|
| `-TenantId contoso.onmicrosoft.com` | Sign in to a specific tenant. |
| `-DeviceCode` | Sign in with a code instead of a browser window. |
| `-NoDashboard` | Set up only; don't start the dashboard. |
| `-InstallPath D:\tools\pcx` | Install somewhere else. |
| `-NonInteractive` | Never ask questions; use only the options given. |

> Run the script as a file. Pasting its contents into a PowerShell window doesn't work.

### Start the dashboard later

```powershell
pcx serve --open
```

The dashboard runs on your machine only (`http://127.0.0.1:4820`). The link it opens carries a one-time key, so other sites and other people on your network can't use it. Press **Ctrl+C** in the PowerShell window to stop it.

### Update to the latest version

Run `setup.ps1` again, or in the repository folder:

```powershell
git pull
cd env-console
npm run build
```

Then restart `pcx serve` and press **Ctrl+F5** in the browser.

## Signing in

The console never asks for or stores your password. It borrows your existing PowerShell sign-in (`Connect-AzAccount`) or Azure CLI sign-in (`az login`), and asks it for a short-lived token for each environment when needed. Tokens are kept in memory only.

### From the dashboard

Click **Sign in** on the Overview page. A window shows a short code:

1. Click **Copy**.
2. Click **Open Microsoft sign-in** and paste the code.
3. Pick your work account. The window closes by itself when you're done.

If your organisation blocks sign-in with a code, choose **Use a browser window instead**.

### From PowerShell

```powershell
pcx auth login                 # opens a browser window
pcx auth login --device-code   # shows a code instead
pcx auth status                # checks sign-in against every environment
```

### Several tenants

If your account can reach more than one tenant, set the one your environments are in: **Manage environments › Tenant** in the dashboard, or `pcx config set tenant contoso.onmicrosoft.com`.

## Choosing environments

The console only loads the environments you choose. Signing in doesn't pull in everything your account can reach.

### In the dashboard

- After you first sign in, **Choose environments** opens. It lists every environment your account can reach, found through the Dataverse Discovery service. Search by name or URL, tick the ones you want, and click **Use N environments**. Nothing is ticked except environments you already use.
- Change the choice at any time with **Choose environments** on the Overview page.
- To add a single environment: open **Manage environments** at the bottom of the Overview page. Pick it from **Add one of your environments**, or paste its URL. Its real name is looked up for you.

### In the CLI

```powershell
pcx env select                         # numbered list; type e.g. 1,3,5-7
pcx env select "FormusProLive" "Seb G's Uni Project"
pcx env add                            # pick one from a numbered list
pcx env add https://contoso-uat.crm4.dynamics.com
pcx env remove UAT
```

`--env` on any command also accepts an environment you haven't chosen, by its display name or URL. Only that one is looked up, and it isn't saved.

### Names, short names and types

Each environment has:

- a **display name**, its real name in Power Platform, shown everywhere in the dashboard. You can rename it under Manage environments; that only changes how the console shows it.
- a **short name** for the CLI, such as `UAT` or `FORMUSPROLIVE`, used with `--env`.
- a **type**: **Unmanaged** (DEV, where you build) or **Managed** (everything after DEV). Changes in managed environments need a reason. The type is suggested from the name (names with "dev" or "sandbox" are unmanaged) and you can change it when you add the environment.

### Load every environment instead

If you'd rather see every environment you can reach without choosing, run `pcx config set discovery on`. `off` goes back to choosing.

## Safety: reasons, roles and confirmations

Every change made through the console goes through the same four checks, in the dashboard and the CLI alike.

### 1. Your roles

Before any change, the console reads your security roles in that environment, including roles you get through teams, and refuses the change if they don't allow it. Nothing is sent to Dataverse, and the message names the role you need.

| Change | Role needed |
|---|---|
| Turn flows, business rules or plugin steps on or off | System Administrator or System Customizer |
| Remove unmanaged changes | System Administrator or System Customizer |
| Table and column auditing | System Administrator or System Customizer |
| Environment variable values | System Administrator or System Customizer |
| Cancel or resume background jobs | System Administrator or System Customizer |
| System auditing, plugin trace log setting | System Administrator |
| Other people's user settings | System Administrator |

Each environment card on the Overview page shows your access there: **System Administrator**, **System Customizer**, or **Read only**. Switches you can't use are greyed out, and hovering over them says why. In the CLI, `pcx access` shows the same.

Roles are recognised by their built-in template, so renamed or translated roles still count. To let a custom role make changes too, add it to the [configuration file](#configuration-file). Dataverse still checks its own privileges on every call; this is an extra gate, not a replacement.

### 2. A reason (managed environments)

Changes in a managed environment need a reason of at least three characters, such as a ticket number: "SAP outage INC-123". Unmanaged environments (DEV) don't need one. The reason is written to the activity log.

### 3. Confirmation

Every change to an environment is confirmed before it's applied:

- **Dashboard:** a window lists each item and environment that will change, and the reason. **Cancel** has the focus, so pressing Enter by accident changes nothing.
- **CLI:** pcx prints what it will do and asks `Go ahead? [y/N]`. In scripts, add `--yes`; without it nothing changes and pcx exits with code 3. `--dry-run` shows the change without asking or doing anything.

Things that only affect the console itself don't ask: choosing, adding, renaming, hiding or removing environments from the list, changing tenant, signing out and sending alerts to Teams.

### 4. The activity log

Every change is logged with the time, environment, item, what changed, the reason, who did it, whether it came from the CLI or the dashboard, and whether it worked. See [Activity page](#activity-page).

### Picking environments for a bulk change

When a change can go to several environments (bulk flow changes, auditing, user settings), the **Apply to** list starts with nothing ticked. Tick the environments you mean, or use **Select all**.

## Overview page

The first page. One card per chosen environment shows:

- its display name, and whether it's **Managed** or **Unmanaged**;
- its address (click to open the environment);
- **Connected** and its version, or why it can't be reached (for example "Sign-in needed");
- how many solutions are installed, and how many cloud flows and plugin steps are switched on;
- **your access** there (your security roles);
- links to that environment's flows, run history and background jobs.

Above the cards:

- **Account:** who you're signed in as, with **Sign in again** and **Sign out**.
- **Alerts:** how many problems there are in the last 24 hours. Click **View alerts** for the list.
- **Download report / CSV:** see [Reports](#reports).
- **Choose environments:** see [Choosing environments](#choosing-environments).

At the bottom, **Manage environments** lets you add an environment (from the list or by URL), rename how it's shown, save one, hide or remove one, create a new one, and set the tenant.

## Alerts page

Problems across every environment in the last 24 hours, worst first:

| Alert | Severity |
|---|---|
| Environment can't be reached (or sign-in needed) | Critical |
| Connection reference with no connection (flows using it can't run) | Critical in managed environments, Warning in DEV |
| Cloud flow failed (with how many times and the latest error) | Warning |
| Plugin failed (with how many times and the latest error) | Warning |
| Background jobs failed, or suspended or stuck | Warning |
| Environment variable with no value | Warning |
| Auditing is off in a managed environment | Warning |
| Plugin tracing is off in a managed environment (errors aren't recorded) | Info |

- The **Area** table shows how many alerts of each kind every environment has.
- Filter the list by **Critical**, **Warnings** or **Info**. **Open** goes to the page where you fix it.
- **Send to Teams:** posts alerts to a Teams channel. Set the channel first with `pcx config set teams-webhook <url>`, using an Incoming Webhook URL from the channel.
- **Scheduled checks:** `pcx alerts schedule --every 60 --install` creates a Windows scheduled task that checks every hour and posts only new alerts.

## Installed solutions page

Every solution in every environment, with its version, in one table with one column per environment.

- **Highlighted** versions differ from the last environment in the list (usually PROD).
- **M** means managed, **U** unmanaged. **—** means it isn't installed there.
- **Publisher:** click one or more publishers to show only their solutions. The number is how many solutions each has.
- **Show Microsoft solutions:** Microsoft's own solutions are hidden by default.
- **Only version differences:** shows only solutions whose version differs somewhere, or that are missing from an environment.
- **Search:** by display name or unique name.
- **Compare** on a row opens [Solution compare](#solution-compare-page) for that solution.
- **Refresh** reads every environment again.

CLI: `pcx solution list --diff-only --publisher fp`

## Solution compare page

Pick a solution and two environments (**From** and the one to compare with, for example UAT and PROD). Every component of the solution gets a status:

| Status | Meaning |
|---|---|
| Same | Identical in both. |
| Different | The definition differs. Click **View diff** to see a line-by-line comparison (XML or JSON, tidied so real changes stand out). |
| Only in A / Only in B | Missing from the other environment. |
| Unmanaged change | Someone edited a managed component directly in that environment, so it no longer matches what was deployed. |

Use **Show** to filter by status. **Include Microsoft solutions in the list** adds Microsoft's solutions to the solution picker.

**Remove unmanaged change** takes away a direct edit so the deployed (managed) version shows again. It can't be undone. It works for tables, columns, relationships, option sets, security roles, views, charts, forms, web resources, site maps, apps, flows and business rules, and plug-in steps. Other component types are removed in the maker portal.

CLI: `pcx solution diff CoreCase --from UAT --to PROD` (exit code 1 when there are differences, handy in pipelines).

## Connections and variables page

The usual reason a flow won't switch on after a deployment: a variable without a value, or a connection reference without a connection.

- **Environment variables:** one row per variable, one column per environment, showing its current value (or its default). **No value** means nothing is set; **Not here** means the variable isn't in that environment. Secret variables show as **Secret (Key Vault)** and are never read; manage them in Azure Key Vault.
- **Edit** a value, give a reason in managed environments, click **Save** and confirm.
- **Connection references:** **Connected** or **Not connected** in each environment, with the connector. Connections are set in the maker portal, because they belong to a person or service account.
- **Only problems** hides rows where everything is set.

CLI: `pcx vars list`, `pcx vars set --env UAT fp_ApiUrl https://api.contoso.com --reason "CHG-42"`, `pcx connections list`.

## Flows, business rules and plugins page

Switch automation on and off, one at a time or in bulk, with every environment side by side.

- Choose **Cloud flows**, **Business rules** or **Plugin steps** at the top.
- Each row is one item; each column is an environment. The switch shows whether it's on there. **—** means it isn't in that environment.
- **Highlighted rows** are on in some environments and off in others.
- **Show Microsoft and system items:** by default only your own (custom) items are shown.
- **Only where environments differ:** shows only rows that differ between environments.

To change one item in one environment, click its switch. To change several:

1. Tick the rows.
2. In the bar that appears, tick the environments under **Apply to**.
3. Enter a reason if any of them is managed.
4. Click **Turn on** or **Turn off**, check the list, and confirm.

While a flow is off it doesn't run; while a plugin step is off it's skipped.

CLI:

```powershell
pcx flows list                                  # one column per environment
pcx flows off --env UAT --filter "SAP" --reason "SAP outage INC-123"
pcx plugins on --env PROD AccountPreUpdate --reason "Fix deployed CHG-456"
```

## Run history page

Cloud flow runs and plugin errors in every environment, with the error behind every failure.

- **Period:** 24 hours, 7 days or 30 days.
- **Summary table:** flow runs, failed runs, failure rate, plugin errors and the plugin trace log setting, per environment.
- **Flow runs per day:** one small chart per environment, succeeded (blue) and failed (pink). Hover over a bar for the numbers.
- **Failures by component:** which flows and plugins fail most, in each environment, with the latest error, and **Turn off…** to stop one quickly.
- **Flow runs / Plugin log:** the individual runs and errors. **Details** shows the full error. **Failures only** hides successful runs.

**Plugin trace log** decides which plugin runs are recorded: **Off**, **Exceptions** (errors only, recommended) or **All** (every run; fills storage quickly, so turn it back down after troubleshooting). Plugin errors only appear here when it's on.

CLI: `pcx runs list --env UAT --since 7d --failed`, `pcx runs trace --env UAT --set exceptions --reason "Troubleshooting INC-77"`.

## Background jobs page

System jobs (asynchronous operations) that need attention in every environment:

| State | Meaning |
|---|---|
| Failed | Finished with an error. |
| Suspended | Stopped and waiting to be resumed, usually after an error. |
| Waiting over 1 hour | Should have started long ago. |
| Running over 2 hours | May be stuck. |

Tick jobs and choose **Resume** (runs them again straight away) or **Cancel** (stops them for good; can't be restarted).

CLI: `pcx jobs list`, `pcx jobs cancel --env UAT <job-id> --reason "Stuck import"`.

## Audit page

Dataverse auditing, from the whole system down to each column, in every environment.

- **System:** per environment, the **Auditing** master switch (nothing is audited while it's off), **User sign-in logging**, and how long logs are kept.
- **Tables:** whether each table is audited, per environment. Use **Filter tables** to find one. Click a switch to change one table, or tick tables, tick the environments under **Apply to**, and choose **Turn auditing on** or **Turn auditing off**. Changed tables are published automatically.
- **Columns:** click a table name to see and change auditing for each of its columns.
- **History:** the audited changes for the selected table, or click a column name for just that column: when, who, what action, which record, and old → new values. Choose the **Time range** above it.

Some tables and columns can't have auditing changed; they show as a plain On/Off label instead of a switch.

CLI: `pcx audit status --env PROD`, `pcx audit set on --env UAT --table account --table contact --reason "Audit review"`, `pcx audit log --env PROD --table account --since 7d`.

## Security page

Who has which roles in every environment, and how roles differ.

- **Users:** one row per person (matched by their sign-in name), one column per environment, listing their roles. Roles through teams are shown separately. **Only where roles differ** shows people whose roles aren't the same everywhere; **Users with no roles** finds people who can sign in but can do nothing.
- **Roles:** which roles exist in which environment, how many people hold them, and **Missing** where a role isn't there.
- **Compare privileges:** opens a panel beside the role comparing its privileges between environments (create, read, write, delete and so on, with the access level each grants: user, business unit, parent-child or organisation). **Only differences** narrows it to privileges that differ.

CLI: `pcx security users --diff-only`, `pcx security roles`, `pcx access`.

## User settings page

Set one standard for personal options and apply it to many people in several environments at once.

- **Formats:** region (numbers and currency), date format, time format, time zone, language and records per page. Leave a field on **Don't change** to leave it alone. **How it will look** shows a sample date, number and currency.
- **Who gets these settings:** tick the environments under **Apply to**, then choose **All enabled users**, **Users with a security role**, **Members of a team** or **Users in a business unit**, and type the role, team or business unit name.
- **Also overwrite settings users changed themselves:** by default, people who changed their own settings are left alone.
- **Make these the defaults for new users:** also sets the organisation's format settings.
- **Preview** fills in **Who will change**: per environment, how many people are in scope, how many will change, and how many already match. **Apply settings** asks you to confirm first.

CLI: `pcx usersettings apply --env UAT --region en-GB --timezone 85 --dry-run`.

## Activity page

Every change made through the console (dashboard and CLI): when, environment, what, the item, the reason, who, where from, and whether it worked. Failed attempts are recorded too.

The log is a file (`%USERPROFILE%\.pcx\actions.log`, one entry per line) so it can be kept or collected. If Dataverse auditing is on, changes are also in the environment's own audit history under your name.

## CLI page

A terminal inside the dashboard that runs `pcx` commands on your machine, with a list of commands on the right. Click an example to put it in the box, press **Enter** to run it, and use **↑** and **↓** for earlier commands.

Commands that change something show what they'll do and open the usual confirmation; they only run once you confirm. Signing in and starting the dashboard aren't available here (use the Overview page for signing in). The terminal isn't available on a hosted site.

## Creating environments

**Create environment** (under Manage environments) or `pcx env create` creates a new environment with a Dataverse database, waits until it's ready (usually a few minutes), and lists it.

| Field | Notes |
|---|---|
| Name | Its display name. |
| Type | Sandbox (default), Production, Developer or Trial. |
| Region | Where it's hosted, for example United Kingdom or Europe. |
| URL name | The first part of its address (`<name>.crm11.dynamics.com`). Chosen for you if empty. |
| Currency | Three-letter code, GBP by default. Can't be changed later. |
| Language | Base language code, 1033 (English) by default. Can't be changed later. |
| Security group | Optional. Only members of this Entra group get access. |

- It needs the **Power Platform administrator** or **Dynamics 365 administrator** role, unless your tenant lets everyone create environments. If you don't have it, the message says so.
- It uses your tenant's Dataverse capacity, so it always asks you to confirm.
- You can close the progress window; creation carries on and the environment appears when it's ready.

```powershell
pcx env create --name "FormusPro UAT 2" --region unitedkingdom --type Sandbox --domain fp-uat2 --dry-run
pcx env create --name "FormusPro UAT 2" --region unitedkingdom --type Sandbox --domain fp-uat2
```

## Reports

**Download report** (Overview and Alerts pages) or `pcx report` creates a health and drift report for every chosen environment:

- health per environment: reachable, version, solutions, flows and plugin steps on, flow runs and failures, plugin errors, trace log setting, failed and stuck jobs, variables and connections not set, auditing;
- current alerts;
- solution drift: solutions whose version differs or that are missing somewhere;
- every solution and its version per environment.

The HTML report prints well; use the browser's Print › Save as PDF. **CSV** gives one row per environment for Excel.

```powershell
pcx report --days 7 --format html --out health.html
```

## Themes and display

Choose **Light**, **Dark** or **System** at the bottom of the menu. System follows your Windows setting. The choice is remembered in this browser.

- **Light:** white cards on a soft white page, FormusPro blue headings.
- **Dark:** neutral charcoal greys, easy on the eyes in a dark room.
- **Windows high contrast:** the console uses your contrast theme's colours automatically.

The console follows the FormusPro brand guidelines: blue logo top left, magenta only as an accent, the Aptos typeface (Segoe UI where Aptos isn't installed).

## Command reference

Run `pcx --help` for the full list. Common options:

| Option | Meaning |
|---|---|
| `--env NAME` | Short name, display name or URL of an environment. |
| `--reason TEXT` | Why you're making the change (needed in managed environments). |
| `--yes` | Go ahead without asking (for scripts). |
| `--dry-run` | Show what would change; change nothing. |
| `--json` | Machine-readable output. |
| `--saved-only` | Use only the chosen environments; don't look anything up. |
| `--config FILE` | Use another configuration file. |

| Command | What it does |
|---|---|
| `pcx auth login` / `status` | Sign in; check sign-in everywhere. |
| `pcx env list` | Health of every chosen environment. |
| `pcx env select` | Choose which environments to use. |
| `pcx env add [<URL>]` | Add one (no URL: pick from a list). |
| `pcx env remove NAME` | Remove one from the console. |
| `pcx env discover` | List every environment your account can reach. |
| `pcx env create ...` | Create a new environment. |
| `pcx access` | Your roles everywhere and what they allow. |
| `pcx solution list` / `diff` | Installed solutions; compare one between environments. |
| `pcx flows`, `rules`, `plugins` `list`/`on`/`off` | See and switch automation. |
| `pcx runs list` / `trace` | Run history; plugin trace log setting. |
| `pcx jobs list` / `cancel` / `resume` | Background jobs. |
| `pcx audit status` / `tables` / `columns` / `log` / `set` | Auditing. |
| `pcx security users` / `roles` | Roles across environments. |
| `pcx usersettings show` / `apply` | Personal options in bulk. |
| `pcx vars list` / `set`, `pcx connections list` | Variables and connection references. |
| `pcx alerts list` / `run` / `schedule` | Alerts and Teams posting. |
| `pcx report` | Health and drift report. |
| `pcx serve --open` | Start the dashboard. |
| `pcx config ...` | Settings (tenant, provider, Teams webhook, discovery). |

Exit codes: `0` success, `1` something failed, `2` the command was typed wrong, `3` a change wasn't confirmed (nothing changed).

## Configuration file

Settings live in `%USERPROFILE%\.pcx\config.json` (or `pcx.config.json` in the current folder, or the file named in `PCX_CONFIG`). `pcx config path` shows which one is used. You rarely need to edit it by hand.

```json
{
  "tenantId": "contoso.onmicrosoft.com",
  "auth": { "provider": "azps" },
  "environments": [
    { "name": "DEV", "label": "FormusPro Dev", "url": "https://contoso-dev.crm11.dynamics.com", "managed": false },
    { "name": "PROD", "label": "FormusPro", "url": "https://contoso.crm11.dynamics.com", "managed": true }
  ],
  "roles": { "customize": ["Release Manager"], "admin": [] },
  "alerts": { "teamsWebhook": "https://..." }
}
```

| Setting | Meaning |
|---|---|
| `tenantId` | Tenant to sign in to. Optional. |
| `auth.provider` | `azps` (PowerShell, default) or `azcli` (Azure CLI). |
| `environments` | The chosen environments: short name, display name, URL, managed. |
| `roles` | Extra role names allowed to make changes (`customize`) or change settings (`admin`). |
| `discovery` | `true` loads every reachable environment instead of only the chosen ones. |
| `hiddenEnvironments` | Environments hidden from the list when `discovery` is on. |
| `alerts.teamsWebhook` | Teams channel for alerts. |
| `allowedHostSuffixes` | Extra host endings for sovereign clouds. |

## Hosting for a team

The dashboard can also run as a website (Azure App Service) where each person signs in with their own work account. Everyone then works with their own roles, and Dataverse's own audit shows who made each change. `deploy/deploy-azure.ps1` sets it up in one go: app registration, admin consent for "Dynamics CRM, act as the user", the App Service and the app itself. See the README for the steps.

On the hosted site, environments come from the site's configuration; choosing environments, creating environments and the terminal are available on your own machine only.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Sign-in needed" on every card | Click **Sign in** on the Overview page, or run `pcx auth login`. |
| The sign-in window stays on "Getting a sign-in code…" | Wait up to 30 seconds. If no code appears, choose **Use a browser window instead**. The window shows what PowerShell printed. |
| Choosing a work account does nothing (Windows account picker) | Sign in with the dashboard's **Sign in** button or `pcx auth login`; the console turns the Windows account picker off for its own sign-in. |
| Asked to pick a subscription | Not needed; the console turns that off. Run `setup.ps1` again if it still appears. |
| `Cannot find module '...\env'` | You ran the script contents in Windows PowerShell. Use PowerShell 7 and run the file. |
| An environment says "Not reachable" | Check the URL, that your account has a user in that environment, and the tenant setting. |
| "You need the System Administrator or System Customizer role" | Ask an administrator for the role in that environment, or have someone with it make the change. |
| A switch is greyed out | Hover over it: you don't have the role for that change in that environment. |
| No plugin errors in Run history | Set the plugin trace log to **Exceptions** in that environment. |
| A page looks out of date after an update | Press **Ctrl+F5**. After pulling new code, run `npm run build` and restart `pcx serve`. |
| A script stops with exit code 3 | It needed confirmation. Add `--yes`. |

## Glossary

| Term | Meaning |
|---|---|
| Managed environment | An environment after DEV (TEST, UAT, PROD). Solutions arrive there as managed; changes need a reason. |
| Unmanaged environment | DEV, where solutions are built. |
| Unmanaged layer | A direct edit to a managed component in a managed environment, so it no longer matches what was deployed. |
| Connection reference | A placeholder in a solution that flows use to find their connection; each environment needs its own connection. |
| Environment variable | A setting in a solution (a URL, an ID) that can have a different value in each environment. |
| Plugin step | Registered custom code that runs when something happens in Dataverse, for example before an account is updated. |
| Plugin trace log | Dataverse's record of plugin runs and errors. |
| Background job | A system job that runs in the background: workflows, imports, bulk deletes. |
| Discovery service | Microsoft's service that lists the environments your account can reach. |
