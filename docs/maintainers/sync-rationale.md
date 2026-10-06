# `josh sync` — rationale

This is maintainer-only rationale behind `docs/sync.md`: the arguments that justify what
`josh sync` distributes and how. A consumer needs none of it to run `josh sync`, and a change to
this file changes no behavior (joshuafolkken/kit#2896).

## The skills ship as a plugin

**The distributed skills ship as the `kit` Claude Code plugin, not as copies
(joshuafolkken/kit#1879).** `.claude/settings.json` still overwrites the consumer's file because it
carries the `permissions.deny` rules a plugin cannot provide; it also declares the `kit` marketplace
and enables the plugin, so in a trusted workspace nothing needs installing. `josh sync` removes a
stale copied skill directory only when its content still matches the shipment, and keeps — with a
warning — one the consumer edited or authored. A retired skill has no package source left to compare
against, so its leftover copy is matched against the recorded hash of its last distributed content
instead: an untouched copy is removed, an edited one is kept with a warning.

## Dependabot: the github-actions backstop and npm version updates

**GitHub Actions workflows are single-sourced by the kit.** Every consumer-facing workflow is
overwritten on each `josh sync`, so action SHA pins are bumped once — by kit's own `github-actions`
Dependabot — and propagated to every consumer. The distributed `github-actions` entry stays as a
backstop for workflows a consumer adds; in synced workflows it finds nothing to bump.

**The `npm` entry opens no routine version-update PRs** (joshuafolkken/kit#803). It sets
`open-pull-requests-limit: 0`, because `josh latest` already bumps npm dependencies at the start of
every `fullrun` / `halfrun` / `backlogrun`, and weekly Dependabot PRs would only duplicate it at the
cost of a CI run each. Security update pull requests "are not subject to this limit and do not count
toward it", so an advisory still opens an npm PR — provided Dependabot security updates are enabled.

**`josh init`, `josh sync` and `josh doctor` therefore report that setting.** With it off a consumer
receives no npm PRs at all, and the absence of a PR is indistinguishable from the absence of an
advisory. All three query `GET /repos/{owner}/{repo}/automated-security-fixes` and print `enabled`,
`paused`, `disabled` or `could not be read`. `sync` always reports, because it always writes the
file; `init` and `doctor` report only where kit's config is present, since `init` skips a file the
consumer already has and `doctor` is often run outside any consumer. An unreadable result is
reported as unchecked rather than as off — a 404 or a token without the scope is not evidence — and
never fails the command. kit prints the enabling command but never runs it: a repository setting is
the maintainer's call. A paused repository is already `enabled: true`, so it is resumed from
Security → Dependabot instead.

## The auto-merge workflow and what it never merges

**The workflow that merges the github-actions PRs is distributed too** (joshuafolkken/kit#834).
Without `.github/workflows/dependabot-auto-merge.yml` a consumer receives the machinery that _opens_
Dependabot pull requests and none that _closes_ them, so bumps sit green, mergeable and unmerged. It
merges `github-actions` **patch and minor** bumps only, and never an npm bump: the only npm pull
request that reaches it is a security advisory, which a human should read.

**It merges a bump only in a workflow the consumer owns.** A bump to a workflow an upstream package
distributes is left open, because the next `josh sync` rewrites those pins regardless. Merging it
would loop — Dependabot bumps the pin, the workflow merges it, `josh sync` writes it back, Dependabot
proposes it again — with a full CI run each round. Those pins are maintained at the source.

## The managed-workflow stamp

**Each distributed workflow says so itself, rather than appearing on a list**
(joshuafolkken/kit#844). Every workflow this package writes into a consumer gets a two-line header
naming the package that wrote it:

```yaml
# josh-managed-workflow: @joshuafolkken/kit
# Overwritten on every sync of that package. Edit it there, not here.
```

The auto-merge workflow reads each changed workflow at the pull request's head and looks for that
header on the first line, so "will an upstream package overwrite this?" is answered by the file being
asked about. **A list can only speak for the package that holds it, and some kit consumers are
distribution packages themselves**: app-kit copies files into _its_ consumers, some _derived_ from
kit's own, so two packages can manage the same path and whichever `sync` ran last decides its
contents. kit cannot know at its own write time what app-kit distributes, but a stamp written by the
package that overwrites the file needs no such knowledge, and any number of tiers can each stamp
their own output. Because a derived tier overlays the base, the base syncs first and the overlay
after it — the reverse would write kit's original over the overlay on every run.

The stamp is applied by the same write-time transform that resolves the action pins, so no file or
renamed mapping arrives without it. The directory copy bypasses the transform, and a kit unit test
holds its workflow entries to an empty list. Local composite actions a distributed workflow calls
(`.github/actions/*`) are stamped too, since the distributed `dependabot.yml` bumps them.
`deploy-vps.yml` is patched by sync but written directly, so it is never stamped and a bump to its
own pins still merges — a property of how the file is written. `josh init` leaves an existing file
unstamped, because it may be the consumer's own and a false ownership header would hold every bump
to it back; it warns instead that the auto-merge workflow will read the file as consumer-owned.

**A package built on kit stamps its own files through the same helper**, exported as
`@joshuafolkken/kit/managed-marker` (`managed_marker_logic.apply_marker_for_destination`, given the
distributor's own package name). A second implementation that spelled the token differently or
stacked a duplicate would silently break the check, which matches the token rather than any package
name.

Two failure modes are decided on the safe side. A changed workflow that cannot be read at the head
fails the step rather than being answered; no output lands on the same side as "managed", but
visibly. And the narrowing to workflow paths happens inside the `--jq` query rather than through
`grep`, whose exit status cannot tell "no match" from "could not look".

## Arming and withdrawing auto-merge

**The decision is made once, and one step makes the pull request match it** (joshuafolkken/kit#845).
`gh pr merge --auto` outlives the run that set it, so not arming is not the same as undoing an
earlier arm. Two steps would need exactly complementary conditions with nothing enforcing it; one
step takes both directions from two declarations. `MAY_ARM` asks whether this **run** is entitled
to decide — the actor is Dependabot and the diff holds no upstream-managed workflow.
`SHOULD_BE_ARMED` asks whether this **bump** qualifies: `MAY_ARM` verbatim plus the `github_actions`
ecosystem and a patch or minor update — a unit test holds that containment, so the two cannot drift.
They stay **expressions** so kit's tests evaluate the very same string with GitHub's engine over a
matrix of actor, upstream-managed, ecosystem and semver level; moved into shell, every guard would
decay into a substring match.

**The withdrawal keys on entitlement, not qualification.** A bump that merely does not qualify — an
advisory, a major — is left alone on an entitled run: a maintainer who armed it by hand decided so.
An arm the run is not entitled to is withdrawn even when a human made it, because a push nobody
reviewed is not made reviewed by who armed it earlier. The step reads the current state first, since
`--disable-auto` errors on a pull request with nothing to disable.

**A step that could not answer publishes no outputs, and the chain that names it goes false.** A
failed upstream-managed check costs the run its entitlement, so an arm it finds is taken back, and
fails its step loudly, since a guess there would let an unreviewed bump merge silently. A failed
metadata step costs only qualification: nothing is armed, an earlier verified arm is left alone, and
the open pull requests piling up announce it. `dependabot/fetch-metadata` runs with
`continue-on-error: true` (it fails whenever a maintainer amended or rebased the bump), and the
reconciling step carries `if: '!cancelled()'` so either failure still reaches it.

**The two directions are not equally dangerous.** Failing to arm leaves the bump open for a human;
failing to withdraw leaves an auto-merge armed on an unreviewed diff, and a non-required check cannot
hold the merge back. So the state read and `--disable-auto` retry with a widening delay, while **the
arming call does not retry**. When the state cannot be read, the withdrawal is attempted anyway and
arming refuses. Only the arming call carries `--match-head-commit`, which GitHub receives as
`expectedHeadOid` and uses to refuse an arm if the branch moved since the run decided; a stale
withdrawal costs at most a re-arm on the next run.

When the withdrawal still fails, the run **comments on the pull request** (joshuafolkken/kit#846),
where someone looking at the merged pull request will find it. A marker naming the head and what was
established keeps a re-run from repeating it without new information, and a final state read keeps
it quiet when nothing is armed after all. A stray notice during an outage is the deliberate side of
the trade against an unreviewed merge in silence.

**One run at a time per pull request.** Without a `concurrency` group, a run overtaken by a
force-push that added an upstream-managed workflow could arm after the newer run reconciled, with
nothing left to undo it. Both copies declare `group: ${{ github.workflow }}-${{ github.ref }}` with
`cancel-in-progress: true`; `github.ref` is the pull request's merge ref, so one bump never waits on
another's. `ci.yml`'s sha-per-`push` clause never fires here, and copied without its
`github.event_name == 'push'` guard it would give each push its own group and cancel nothing. kit's
**own** copy has no upstream-managed exclusion and so nothing to withdraw: there
`.github/workflows/*` is the source of truth.

## The Allow auto-merge prerequisite

**`josh init`, `josh sync` and `josh doctor` report that workflow's prerequisite too.**
`gh pr merge --auto` fails with `Auto-merge is not allowed for this repository` unless the
repository's **Allow auto-merge** setting is on, and it is off by default. All three read
`allow_auto_merge` from the whole `GET /repos/{owner}/{repo}` object — a `--jq` projection cannot
tell `false` from a field a non-admin token never receives — and print `enabled`, `disabled` or
`could not be read`. `sync` always reports; `init` and `doctor` report only where a workflow calling
`gh pr merge --auto` is present, a consumer's own included. kit prints the enabling command and never
runs it, `josh doctor --fix` included: the setting is outward-facing, needs admin scope, and is the
maintainer's call.

## Action pins are resolved at write time

**Pins are resolved when the file is written, not read from the template** (joshuafolkken/kit#747).
Every workflow `josh init` and `josh sync` write passes through
`workflow_pin_logic.apply_pins_for_destination`, which takes each `uses:` ref from kit's own
`.github/workflows/*`. Dependabot can only scan `.github/workflows/**` and a root `action.yml`, so it
never updates `templates/workflows/*`; resolving at write time keeps that blind spot from reaching
consumers.

## The deny list in .claude/settings.json

**`.claude/settings.json` denies the commands the prompts forbid most often** (joshuafolkken/kit#850).
Prose is only honored while it is being read, so staging, committing and merging are denied
mechanically, in both their `gh`/`git` and REST spellings, along with force pushes and branch
deletion:

```json
"Bash(git add*)", "Bash(git stage*)", "Bash(git rm*)", "Bash(git mv*)",
"Bash(git reset*)", "Bash(git restore --staged*)", "Bash(git restore -S*)",
"Bash(git commit*)", "Bash(gh pr merge*)",
"Bash(gh api *pulls/*/merge*)", "Bash(gh api graphql*mergePullRequest*)",
"Bash(git push *--force*)", "Bash(git push * -f)", "Bash(git push * -f *)",
"Bash(git push * +*)", "Bash(git push *--delete*)", "Bash(git push -d*)",
"Bash(git push * -d)", "Bash(git push * -d *)", "Bash(git branch -d*)",
"Bash(git branch -D*)", "Bash(git branch --delete*)",
"Bash(gh api *DELETE*git/refs/heads/*)", "Bash(gh api *git/refs/heads/*DELETE*)"
```

The merge entries match the **path**, not the method, because `-X PUT` may come before or after it;
a `GET` of that path is refused too, and merge state is read from `pulls/{N}` instead. **Each flag
git spells two ways is denied both ways, in both positions**, plus `+<ref>`, which force-updates with
no flag. The short flags carry a leading space so a branch whose name ends in `-f` can still be
pushed. A grouped short flag (`git push -uf origin main`) still gets through: the glob cannot say
"inside the first token", and every pattern that catches it also catches an ordinary push.

**A rule cannot match a literal `:`.** Measured against the running harness, an entry containing
`:` matches nothing — the character is rule grammar. So `git push origin :branch` cannot be denied
and is left to the prose rule, and `claude-settings.test.ts` fails a colon entry that would ship as a
guard never in force.

**No josh step is affected.** `pnpm josh git` and `pnpm josh followup` run git and gh inside node
scripts, so the Bash matcher only ever sees the `pnpm josh …` wrapper, and no josh step deletes a
branch or force-pushes. `git commit` is denied whole because `-a` and `-m` are the fallbacks a
refused `git add` pushes toward; an environment assignment ahead of it does not escape the matcher.
`git rm` is denied whole because `--cached` alone would let `-r --cached` through.
`git restore <path>` stays open as the documented undo for a deletion — unblocked, not endorsed.

**It is a guardrail, not a sandbox.** Prefix patterns leave plenty reachable (`git -C . add .`,
`git update-index`, `git apply --cached`, `git merge`, `git stash`, …), and closing them all would
mean denying `git` and its read-only inspection with it. The deny stops the habitual form;
`CLAUDE.md` stays the authority, and a command being let through is not permission. An explicit
staging request is blocked for the agent too — deliberately; the user runs it in their own terminal.

## The Bash output cap

**The same file caps what one command's output contributes to the context.** Its `env` block sets
`BASH_MAX_OUTPUT_LENGTH`, which Claude Code applies by middle-truncating a longer result, so the
limit sits in the harness rather than in an agent's judgement. The 30,000-character default never
fired on a measured result, which is why the distributed value is lower;
`prompts/collaboration-workflow/output-bounds.md` holds the value and its measurement, and
`scripts/lib/bash-output-cap.test.ts` fails a value that would not fire.

## The Artifact tool is switched off in kit only

**kit's own `.claude/settings.json` sets `"enableArtifact": false` (joshuafolkken/kit#3140)**,
because the Artifact tool adds roughly 12k tokens to every API call of an interactive session.
`"disableClaudeAiConnectors": true` saved nothing there, so it is not set.

**The key is kit-only because it cannot be undone below the layer that sets it.** Claude Code
switches the tool off when any settings layer sets `enableArtifact` to `false`, and a `true` in
`.claude/settings.local.json` or on `--settings` does not bring it back. A shipped `false` would
take the tool from every consumer with no way back, so `claude-kit-only-settings.ts` removes the key
from the copy `josh init` and `josh sync` write; a consumer who wants the saving sets it themselves.

## The verify-ui skill

**`.claude/skills/verify-ui/` is the UI gate's implementation** (joshuafolkken/kit#853). It picks the
routes, calls the toolkit's own screenshot command and opens the images. Where no such command
exists it says so and leaves the gate open — a skill that returned success there would read as
closed while verifying nothing. Whether a command exists is read from the command list the toolkit
prints, never assumed.

It is named `verify-ui`, not `verify`, because a project skill at `.claude/skills/verify/` replaces
Claude Code's bundled `/verify`, which records its own recipe at that path — `josh sync` and the
recording would overwrite each other on every run. A unit test keeps every `.github/workflows` path
out of the directory-copy list, which skips the pin-and-stamp transform.

## Skills that hold what the AI documents used to inline

**`.claude/skills/workflow-commands/` and `.claude/skills/dependency-update/` hold what the AI
documents used to inline** (joshuafolkken/kit#854). The rule document is read in full every turn,
so workflow procedure most turns never enter is kept in skills and the document keeps the trigger.
**What stays resident is decided by one question — must the rule fire on a turn where no skill was
loaded?** `.claude/skills/workflow-commands/SKILL.md` → "What stays resident, and what is read from
here" holds the criterion and the list; a unit test asserts each listed rule in `CLAUDE.md` and
headroom under its ceiling. `AGENTS.md` and `GEMINI.md` only point to `CLAUDE.md`, and
`scripts/document/ai-document-pointers.test.ts` fails if a rule body reappears in either.

The skill directory copy runs the same `prompts/…` path rewrite the file copies do, over markdown
only — which is also why no workflow may live there. **The copy merges and never prunes**: a file
dropped upstream stays until someone deletes it, and a file a consumer adds survives every sync.
Deleting the destination first would take the consumer's own files with it, so a removed file is
announced in the release notes rather than cleaned up by sync.

## The hooks in .claude/settings.json

**The post-edit formatter runs on `PostToolUse`**: `pnpm josh format:edited` formats the one file an
`Edit` or `Write` changed, so an agent sees the result of a single edit without a whole-project lint.

**The guards run on `PreToolUse`, because by `PostToolUse` the round trip has already been spent.**
One process, `pnpm josh pretool:guard`, runs all three, each switchable off by its own variable;
`docs/josh-commands-automation.md` carries their conditions and bounds.

- **The batching guard** (joshuafolkken/kit#1390) refuses the call that would make a third
  consecutive single-call turn, on `Edit` and `Read` as well as `Bash` since edits are the largest
  share of recoverable round trips. It **withholds the refusal when the call names a file the
  sequence already touched**, and a refusable edit is content-addressed, so a reissue applies where
  meant or fails visibly. **`Write` earns only a notice**: a reissued whole-file write has no match
  check and could overwrite a sibling's edit. `pnpm josh` commands, commits and Issue writes are
  never refused.
- **The investigation guard** (joshuafolkken/kit#1460) refuses a file read once the run has read a
  threshold's worth of files it has not edited **since its last delegated unit**, counted off the
  transcript so it fires again rather than once per run. On `Bash` it refuses only a line that
  **writes nothing**, under a test of its own so the two guards cannot be moved together by accident.
- **The rule guard** (joshuafolkken/kit#1524) dispatches the rules `scripts/rules/delivered-rules.ts`
  enumerates — those whose trigger is one tool call. **This is what makes a rule cheaper to ship than
  to carry**: `CLAUDE.md` costs every turn, a refusal only at the call that binds it. It reads the
  command string, so a rule keeps a one-line trigger resident for the calls it cannot see.
  `prompts/collaboration-workflow/rule-delivery.md` is the enumeration and its criterion.
