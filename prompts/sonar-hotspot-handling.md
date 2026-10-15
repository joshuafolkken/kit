# SonarCloud Hotspot Handling (project-local extension)

<!-- cspell:words hotspot Hotspot hotspots Hotspots NOSONAR -->

Project-local procedure for SonarCloud Security Hotspots, kept out of the upstream-synced `prompts/collaboration-workflow/`. AI tools cannot do SonarCloud's OAuth browser login, so the primary path is the public API and config.

## Quality Gate enforcement (CI blocks PRs)

The distributed `.github/workflows/sonar-qube.yml` scans with `-Dsonar.qualitygate.wait=true`, so the required `SonarQube` PR check fails on a red Quality Gate. On a pull request the job then runs `pnpm josh sonar:new-code <PR>`, which **fails on a single new issue of any type or severity, or a single new duplicated block** (joshuafolkken/kit#3045) — `Sonar way` judges ratings and ratios, so a few MINOR smells or a small copied block would otherwise pass. An issue resolved in SonarCloud as accepted or a false positive is not counted; that resolution is the route for a deliberate exception.

This job is the single enforcement point: `josh followup` does not scan SonarCloud findings but waits on the required `SonarQube` check, so a red gate blocks its merge too. Consumers get the workflow verbatim via `josh sync`; do not re-implement the gate per consumer.

A run that cannot see `SONAR_TOKEN` skips the scan and passes, printing one line naming the missing token (joshuafolkken/kit#2815). GitHub withholds secrets from fork pull requests and from Dependabot runs without the secret in the Dependabot store, so a repository relying on this gate keeps `SONAR_TOKEN` in both secret stores.

### New Code vs Overall Code semantics

The scan passes `package.json`'s `version` as `sonar.projectVersion`, so New Code ("since the previous version") restarts at every `josh bump` that reaches main.

The default Sonar way gate evaluates New Code only — lines changed in the PR's New Code period:

- A PR that introduces or modifies code tripping a condition is blocked (e.g. a Maintainability `0 -> 1` regression).
- Pre-existing Overall-Code findings on untouched files do not fail an unrelated PR. Enforcing Overall Code needs Overall conditions added in the SonarCloud Quality Gates UI, not a repo file.

Red gate → check in the PR analysis: a New Code condition is this PR's (fix it); an Overall one is pre-existing (handle per the table below, never silently blocking an unrelated change).

## Step A / Step B: fetch the hotspots and read each one's disposition

```bash
pnpm josh sonar:hotspots <PR>
```

Reads the PR's hotspots from SonarCloud's public API (no auth; project key from `sonar-project.properties`) and prints each one's `status`, `component`, `line`, `ruleKey` and Step B branch; upstream-synced paths come from `josh sync:scope`'s detection.

| Branch     | Meaning                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `excluded` | A `TO_REVIEW` hotspot on an upstream-synced file — add the path to `sonar.exclusions`, never edit the file |
| `local`    | A `TO_REVIEW` hotspot on project-local code — a targeted `sonar.issue.ignore.*` rule or NOSONAR comment    |
| `fix`      | A reviewed-and-fixed hotspot — the real issue was fixed                                                    |
| `defer`    | A reviewed hotspot set aside — out of scope for this PR                                                    |

A failed read (rate-limit, network) prints `unreadable: <reason>`, distinct from finding none. `pnpm josh oracle:list` uses the same vocabulary. **Your only judgement: is a `TO_REVIEW` hotspot really a false positive?**

- False positive → apply its `excluded` / `local` branch.
- Real issue → fix the code and add a regression test.
- Out of scope → mention it in the completion comment and open a follow-up Issue.

## Step C: optional — mark SAFE via API if a token is available

With `SONAR_TOKEN` exported (SonarCloud user token with write scope):

```bash
curl -sS -u "$SONAR_TOKEN:" -X POST \
  "https://sonarcloud.io/api/hotspots/change_status" \
  -d "hotspot=<hotspot-key>&status=REVIEWED&resolution=SAFE&comment=<reason>"
```

Without a token, prefer Step B's config-based approach — it is reviewable in the PR diff; API-side state changes are not.

## Reporting rules

- List every outstanding hotspot in the completion comment; never hide a failing SonarCloud analysis.
- State the action taken (excluded / marked SAFE / fixed / deferred) and why.
- Link the follow-up Issue for a deferral.
