# SonarCloud Hotspot Handling (project-local extension)

<!-- cspell:words hotspot Hotspot hotspots Hotspots NOSONAR -->

This guide extends `prompts/collaboration-workflow.md` with a project-local procedure for handling SonarCloud Security Hotspots. It is kept out of the upstream-synced `collaboration-workflow.md` so that file stays byte-identical with `joshuafolkken/tasks`.

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

## Step A: fetch hotspot details via public API (no auth)

```bash
curl -sS "https://sonarcloud.io/api/hotspots/search?projectKey=joshuafolkken_joshuafolkken-com&pullRequest=<PR-number>" \
  | python3 -m json.tool
```

Check each entry for:

- `status`: `TO_REVIEW` (action needed) vs `REVIEWED` (already resolved)
- `component`, `line`: where the hotspot is
- `message`, `ruleKey`: what rule fired

## Step B: decide how to respond

| Situation                                                                        | Action                                                                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| False positive on an upstream-synced file (`.claude/**`, `scripts/git/**`, etc.) | Add the path to `sonar.exclusions` in `sonar-project.properties`. Do **not** edit the upstream-synced file     |
| False positive on project-local code                                             | Document rationale; if suppression is warranted, add a targeted `sonar.issue.ignore.*` rule or NOSONAR comment |
| Real issue                                                                       | Fix the code and add a regression test                                                                         |
| Issue out of scope for the current PR                                            | Mention explicitly in the completion comment and open a follow-up Issue                                        |

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
