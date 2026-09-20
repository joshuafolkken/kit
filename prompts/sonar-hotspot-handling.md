# SonarCloud Hotspot Handling (project-local extension)

<!-- cspell:words hotspot Hotspot hotspots Hotspots NOSONAR -->

This guide extends the collaboration workflow with a project-local procedure for handling SonarCloud Security Hotspots. It is kept out of the upstream-synced `prompts/collaboration-workflow/` topics so those stay identical across the projects that consume them.

AI tools cannot perform OAuth browser login to SonarCloud, so this guide assumes public-API and config-based actions as the primary path.

## Quality Gate enforcement (CI blocks PRs)

The distributed `.github/workflows/sonar-qube.yml` runs the SonarCloud scan with
`-Dsonar.qualitygate.wait=true`. The scanner waits for SonarCloud to evaluate the project's
Quality Gate and **fails the `SonarQube` job — a required PR check — when the gate is red**, so a
PR that introduces a finding cannot be merged green. This is the single enforcement point:
`josh followup` does **not** scan SonarCloud findings (it only scans CodeRabbit / Claude Review
comments), but it **does** wait on the required `SonarQube` CI check, so a red gate also blocks the
`followup` merge. Consumers pick the workflow up verbatim via `josh sync`; do not re-implement the
gate per consumer.

### New Code vs Overall Code semantics

SonarCloud's default **Sonar way** Quality Gate evaluates **New Code only** — conditions
(new bugs, new code smells above the Maintainability rating, new coverage/duplication) apply to
lines changed in the PR's New Code period, not the whole codebase. Consequences:

- A PR is blocked when it **introduces or modifies** code that trips a condition — this is what
  catches the recurring Maintainability `0 -> 1` regression that motivated this gate.
- Pre-existing Overall-Code findings on untouched files do **not** fail an unrelated PR. To make
  the gate enforce Overall Code as well, add Overall conditions to the gate in the SonarCloud
  project settings (Quality Gates UI) — that is a SonarCloud-side configuration, not a repo file.

When triaging a red gate, confirm via the PR analysis whether the failing condition is a **New
Code** condition (caused by this PR — fix it) or an **Overall** condition (pre-existing — handle
per the table below, and do not let it silently block an unrelated change).

## Step A / Step B: fetch the hotspots and read each one's disposition

```bash
pnpm josh sonar:hotspots <PR>   # alias: josh shs
```

The command fetches the hotspots on the pull request from SonarCloud's public API (no auth), reading
the project key from `sonar-project.properties`, and prints per hotspot its `status`, `component`,
`line`, `ruleKey` and the Step B branch it falls into. The one branch key that used to be walked by
eye — "is this path upstream-synced?" — is answered by calling `josh sync:scope`'s own detection, so
no distribution path list is duplicated. The four branches:

| Branch     | Meaning                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `excluded` | A `TO_REVIEW` hotspot on an upstream-synced file — add the path to `sonar.exclusions`, never edit the file |
| `local`    | A `TO_REVIEW` hotspot on project-local code — a targeted `sonar.issue.ignore.*` rule or NOSONAR comment    |
| `fix`      | A reviewed-and-fixed hotspot — the real issue was fixed                                                    |
| `defer`    | A reviewed hotspot set aside — out of scope for this PR                                                    |

A read that failed (rate-limit, network) prints `unreadable: <reason>`, told apart from a success
that found no hotspots. `pnpm josh oracle:list` carries the same vocabulary. **The only judgement
left to you is whether a `TO_REVIEW` hotspot is really a false positive** — if it is, apply its
`excluded` / `local` branch; if it is instead a real issue fix the code and add a regression test,
and if it is out of scope mention it in the completion comment and open a follow-up Issue.

## Step C: optional — mark SAFE via API if a token is available

If `SONAR_TOKEN` is exported (SonarCloud user token with write scope):

```bash
curl -sS -u "$SONAR_TOKEN:" -X POST \
  "https://sonarcloud.io/api/hotspots/change_status" \
  -d "hotspot=<hotspot-key>&status=REVIEWED&resolution=SAFE&comment=<reason>"
```

Without a token, prefer Step B's config-based approach — that change is reviewable in the PR diff, whereas API-side state changes are not.

## Reporting rules

- List every outstanding hotspot in the completion comment (never hide a failing SonarCloud analysis).
- State which action you took (excluded / marked SAFE / fixed / deferred) and why.
- If you deferred, include a link to the follow-up Issue.
