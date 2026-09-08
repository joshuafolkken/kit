# Running kit in a cloud session

A "cloud session" here means an agent container — Claude Code on the web and anything shaped like it —
rather than a developer's own machine. The workflow is the same one this package ships everywhere
else, but three things a laptop supplies quietly are not there by default: an outbound network
policy that reaches the hosts the pre-push audit needs, the `osv-scanner` binary, and, in some
containers, the `gh` CLI itself.

Everything below was measured in real containers while working joshuafolkken/kit#1505. **Two sessions
of the same product differed from each other** — one had `gh` and no scanner, the next had the
scanner and no `gh` — so read each section as a thing to check rather than a thing to assume.

## Network policy — the hosts to allow

| Host                                                 | Required? | What it is for, and what breaks without it                                                                                |
| ---------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `api.osv.dev`                                        | **Yes**   | Where `pnpm josh audit` queries vulnerabilities. Blocked, the pre-push audit cannot run at all and every `git push` fails |
| `osv-vulnerabilities.storage.googleapis.com`         | Yes       | Distribution source of the offline vulnerability database (the alternative route below)                                   |
| `github.com`, `release-assets.githubusercontent.com` | Yes       | Fetching the pinned `osv-scanner` release asset at session start                                                          |
| `api.github.com`                                     | Yes       | Every `gh api` call — issues, pull requests, labels, the merge                                                            |
| `api.telegram.org`                                   | Yes       | Workflow notifications (`josh notify`, `josh followup`)                                                                   |
| `registry.npmjs.org`                                 | Yes       | Dependency install                                                                                                        |
| `api.deps.dev`                                       | Optional  | An auxiliary `osv-scanner` lookup. `josh audit` runs against the lockfile only, so this host is never reached today       |

A blocked host does not look like a network error. `api.osv.dev` rejected at the proxy surfaces as:

```text
Error during extraction: max retries exceeded: request failed:
Post "https://api.osv.dev/v1/querybatch": Forbidden
```

That is the gateway answering `403` to `CONNECT`, which is an organization policy decision and not
something to retry. Allow the host; there is nothing to fix in this repository.

**Allowing `api.osv.dev` discloses nothing new.** The request carries the package names and versions
already in `pnpm-lock.yaml`, which every developer machine and every CI run
(`.github/workflows/ci.yml` → the security audit step) already send.

## osv-scanner — provisioned at session start

Nothing has to be installed by hand. The distributed `.claude/settings.json` carries a `SessionStart`
hook that runs `pnpm josh audit:provision`, which downloads a pinned `osv-scanner` build, verifies it
against a pinned SHA256 and installs it into `node_modules/.cache/josh-tools/`.

- **It looks on `PATH` first**, then in that managed directory. A machine that already has the
  scanner installed is untouched, and the hook exits immediately.
- **It never stops the session.** Every failure prints its reason and exits `0`; the pre-push audit
  then reports the missing binary exactly as it did before.
- **The automatic attempt has a 60-second budget**, because `SessionStart` is awaited and the asset
  is around 55 MB. A slow link runs out of time; `pnpm josh audit:provision --force` retries with a
  ten-minute budget.
- **A failure backs off for 6 hours**, so a container without the release hosts does not re-download
  on every session. `--force` ignores the backoff.

Details and the exact messages: [`josh audit:provision`](./josh-commands.md#josh-auditprovision).

### The offline database is an alternative, not the default

`osv-scanner` can work from a downloaded database instead of the online API, and that route reaches
only `osv-vulnerabilities.storage.googleapis.com`. **`josh audit`'s arguments are deliberately left
alone**, so this is something to know about rather than something to switch on:

| Route                     | Time per run        | Disk   | Freshness                    |
| ------------------------- | ------------------- | ------ | ---------------------------- |
| Online query (what ships) | a few seconds       | 0      | current at the moment of use |
| Offline database          | **22 s first time** | 213 MB | a snapshot of the download   |

A cloud container is destroyed each time, so the offline route pays that 22 seconds and 213 MB every
session. More importantly it changes the answer the gate gives: the audit is meant to say whether a
dependency has a known vulnerability **now**, not as of a download. And because `josh audit` is
invoked by the lefthook config this package distributes, changing its arguments would reach every
consumer repository and every developer machine — for an environment-specific problem the network
policy solves directly.

## Environment variables

| Variable                                 | Guidance in a cloud session                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Inject them as real environment variables. **No `.env` file is needed** — `josh notify` and `josh followup` read one only if it exists |
| `JOSH_SESSION_LANG`                      | Same — an environment variable is enough                                                                                               |
| `JOSH_LANE_LIMIT`                        | **Set it to `2`** on a small container. The default is 6, which is too many for the 4 cores / 16 GB these containers typically have    |
| `GH_TOKEN`                               | Usually injected already, and `gh api` picks it up without `gh auth login` (which is interactive and cannot be run here)               |

A missing Telegram credential now **fails loudly**: `pnpm josh notify` exits non-zero rather than
warning and returning success, and a send from inside `pnpm josh followup` prints an `❗` block
saying nobody was notified while the merge carries on. See
[Notification behavior](./scripts-ai.md#notification-behavior).

## `gh` — REST only, and it has to be installed

**Every GitHub call this package makes is `gh api` (REST).** A cloud session's egress is answered
`403` for GitHub's GraphQL endpoint, so the subcommand forms — `gh issue view`, `gh pr list`,
`gh repo view --json` and the rest — do not work there. `scripts/gh-subcommand-guard.ts` and
`scripts/gh-document-guard.test.ts` hold the code and the shipped documents to that rule, and
`prompts/collaboration-workflow/gh-rest.md` is the rule itself.

Two exceptions, and only two:

- **`gh auth token`** reads the credential the local CLI already holds. It contacts no endpoint, so
  there is no REST call it could be written as.
- **GitHub Actions workflows.** They run on a runner where `gh` works normally, and
  `gh pr merge --auto` uses an API that exists only in GraphQL.

### REST does not make `gh` optional

**Every REST call is still `execa('gh', ['api', …])`.** Migrating away from the subcommands removed
the GraphQL dependency, not the binary dependency — and a container without `gh` was measured, so
this is not hypothetical:

- `pnpm josh doctor` reports that Dependabot security updates could not be read because `gh` is
  missing.
- `pnpm josh epic:next` exits 1.
- `pnpm josh pr` and `pnpm josh followup` cannot finalize anything.

So `fullrun` and `epicrun` do not complete in an environment without `gh`, even though `git push`
over HTTPS succeeds and `GH_TOKEN` authenticates fine against `api.github.com`.

**The failure is easy to misread.** `check_gh_installed` says so plainly —
`gh CLI is not installed. Install it from https://cli.github.com/` — but the commands that read the
repository from the git remote report instead:

```text
Could not read this repository from `git remote`, so the children cannot be keyed by repository —
check `gh auth status` and that this is a checkout with an `origin` remote.
```

which names the remote and the credential rather than the missing binary. `josh epic:next`, `josh epic:bundle`,
`josh issue:scout` and `josh epic --add` all take that shape. **Check `gh` first when one of them
says that.**

### Two closed issues that no longer describe the world

Neither is edited — both are closed — so the correction is recorded here:

- **joshuafolkken/kit#1020 → "Procedure E"** carries a startup script that installs `gh` 2.63.2 to
  `/usr/local/bin/gh`, and its comments confirm `gh` was present in that environment. **A later
  session had no `gh` at all and could not install one**, so "just install it at startup" is not a
  general answer. Read #1020 as a record of one environment, not a procedure that always works.
- **joshuafolkken/kit#1022 → "Out of scope: retiring `gh`"** reasoned that `gh api` inherits auth and
  proxy settings, so only the subcommand form needed replacing. That still holds as a _migration_
  decision, but it is not a statement that `gh` is always available. Retiring `gh` remains out of
  scope and has not been filed; the reasons — `exec_gh_api_sync` needs a synchronous HTTP call node
  does not have, and `--jq` carries arbitrary jq expressions that TypeScript cannot reimplement — are
  in joshuafolkken/kit#1505.

## Lane parallelism and `run:liveness`

Lanes work in a cloud container: `pnpm josh lane:open` creates the linked work tree and assigns a
`PORT_SEED`, and `pnpm josh lane:close` cleans up completely. Two constraints:

- **Set `JOSH_LANE_LIMIT=2`.** The default of 6 assumes a developer machine.
- **`pnpm josh run:liveness`'s process detection does not apply** when the thing running a child has
  no OS process of its own. The command does not look for a process itself — the caller passes
  `--process alive` or `--process none` after running `pgrep`. Where a child is an execution unit
  inside one agent process rather than a spawned command, there is nothing for `pgrep` to find, and
  a `--process none` derived that way says nothing about whether the child is alive. Treat the
  liveness answer as unavailable there rather than as "no process, therefore dead".

## Related

- [`josh audit` / `josh audit:provision`](./josh-commands.md#josh-audit)
- [`josh run:liveness`](./josh-commands.md#josh-runliveness)
- [scripts-ai — notification behavior](./scripts-ai.md#notification-behavior)
