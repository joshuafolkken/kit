# SonarCloud Hotspot Handling (project-local extension)

<!-- cspell:words hotspot Hotspot hotspots Hotspots NOSONAR -->

This guide extends `prompts/collaboration-workflow.md` with a project-local procedure for handling SonarCloud Security Hotspots. It is kept out of the upstream-synced `collaboration-workflow.md` so that file stays byte-identical with `joshuafolkken/tasks`.

AI tools cannot perform OAuth browser login to SonarCloud, so this guide assumes public-API and config-based actions as the primary path.

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
