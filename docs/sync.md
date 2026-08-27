# josh sync — Detailed Behavior

`josh sync` overwrites managed files in your project with the latest versions from the installed `@joshuafolkken/kit` package. Run it after upgrading the package.

```bash
pnpm josh sync
```

Unlike `josh init` (which skips existing files), `josh sync` is designed for keeping managed files up to date. Most managed files are overwritten; `pnpm-workspace.yaml` is merged (see below).

## What gets synced

### AI files (overwritten)

These files are copied verbatim from the package, with one path transformation applied (see below):

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/dependabot-auto-merge.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.claude/settings.json
.claude/skills/verify-ui/   (directory)
.claude/skills/workflow-commands/   (directory)
.claude/skills/dependency-update/   (directory)
```

> **GitHub Actions workflows are single-sourced by the kit.** Every consumer-facing workflow
> (`ci.yml`, `auto-tag.yml`, `production.yml`, `sonar-qube.yml`) is overwritten on
> each `josh sync`, so action SHA pins are bumped once in the kit and propagated to all consumers —
> no per-consumer maintenance. The kit's own `github-actions` Dependabot is what bumps those pins at
> the source; `josh sync` then distributes them. The `github-actions` entry in the distributed
> `dependabot.yml` is intentionally kept as a backstop (it covers any non-kit workflow a consumer
> adds, and finds nothing to bump for synced workflows since their pins are already current).
>
> **The `npm` entry, by contrast, no longer opens routine version-update PRs in any consumer.**
> It sets `open-pull-requests-limit: 0`, which disables version updates only. `josh latest` runs
> at the start of every `fullrun` / `halfrun` / `queue` and already bumps npm dependencies to
> latest, so the weekly Dependabot PRs were duplicating it — in kit they were closed unmerged
> after each had consumed a full CI run, and the same noise was replicated in every consumer that
> synced the file. Security advisories are unaffected — GitHub's Dependabot options reference
> states that security update pull requests "are not subject to this limit and do not count toward
> it" — so an advisory still opens an npm PR, provided the consumer has Dependabot security updates
> enabled. This reaches a consumer on its next `josh sync`. See joshuafolkken/kit#803.
>
> **`josh init`, `josh sync` and `josh doctor` all report that prerequisite.** Because the advisory path is now
> the only npm Dependabot path, a consumer whose `Dependabot security updates` setting is off
> receives no npm PRs at all — and the absence of a PR is indistinguishable from the absence of an
> advisory. All three query `GET /repos/{owner}/{repo}/automated-security-fixes` and print one
> of four results: `enabled`, `paused` (on, but opening no PRs), `disabled`, or `could not be read`.
> `sync` reports unconditionally, because it overwrites the file on every run. `init` and `doctor`
> report only where kit's config is actually present: `init` skips the file when the consumer
> already has its own, and `doctor` is routinely run from a home directory or an unrelated clone to
> diagnose the global install. Past that gate both always report, so a broken `gh` surfaces as
> `could not be read` instead of as silence.
> The last is reported as unchecked rather than as off — a 404 or a token without the scope is not
> evidence that the setting is disabled — and never fails the command. When the setting is **off**
> the report prints the enabling command, addressed at the resolved repository; kit does not run it,
> because changing a repository setting is the maintainer's call. A **paused** repository gets
> different advice: it is already `enabled: true`, so the enable endpoint is a no-op there — it must
> be resumed from the repository's Security → Dependabot page instead. See joshuafolkken/kit#805.
>
> **The workflow that merges the github-actions PRs is distributed too.**
> `.github/workflows/dependabot-auto-merge.yml` is the other half of `dependabot.yml`: without it a
> consumer receives the machinery that _opens_ Dependabot pull requests and none of the machinery
> that _closes_ them. That is the state joshuafolkken/app-kit#184 was found in — all checks green,
> `mergeable: MERGEABLE`, and no `autoMergeRequest` on the pull request, because nothing in the
> repository ever enabled auto-merge. It merges `github-actions` **patch and minor** bumps only, and
> never an npm bump at any semver level: the npm entry above leaves security advisories as the only
> npm pull request that can reach it, and an advisory is exactly the kind a human should read.
>
> **It merges a bump only in a workflow the consumer owns.** A bump to a workflow kit distributes
> (`ci.yml`, `auto-tag.yml`, `dependabot-auto-merge.yml`, `production.yml`, `sonar-qube.yml`) is left
> open instead, because the next `josh sync` rewrites those pins from the installed kit package
> regardless of what was merged. Merging one produces a loop — Dependabot bumps the pin, the workflow
> merges it, `josh sync` writes it back, Dependabot proposes the same bump again — with a full CI run
> on every round. kit 1.93.0 shipped the workflow without this exclusion; joshuafolkken/kit#836 added
> it. The pins in those files are maintained at the source: kit's own Dependabot bumps them and
> `josh sync` distributes the result. See joshuafolkken/kit#802 for the ecosystem gate,
> joshuafolkken/kit#834 for the distribution, and joshuafolkken/kit#836 for the exclusion.
>
> **Each distributed workflow says so itself, rather than appearing on a list.** Every workflow this
> package writes into a consumer gets a two-line header naming the package that wrote it:
>
> ```yaml
> # josh-managed-workflow: @joshuafolkken/kit
> # Overwritten on every sync of that package. Edit it there, not here.
> ```
>
> The stamp is applied by the same write-time transform that resolves the action pins, so a workflow
> distributed as a file or a renamed mapping cannot arrive without it. Two write paths bypass the
> transform: the directory copy, which a kit unit test holds to an empty list, and `deploy-vps.yml`,
> which is deliberately left unstamped for the reason below.
> `josh init` still leaves an existing file alone — it does not stamp one, because the destination may
> hold a workflow the consumer wrote themselves and a header claiming this package owns it would hold
> every bump to it back on a false premise. It warns instead: until `sync` writes a header, the
> auto-merge workflow reads that file as consumer-owned, and the warning names that rather than
> leaving it to be discovered from a revert. The auto-merge workflow then reads each changed workflow at the
> pull request's head and looks for that header on the first line — the answer to "will an upstream
> package overwrite this?" comes off the file being asked about.
>
> Until joshuafolkken/kit#844 the answer came from a list of five paths hardcoded in the auto-merge
> workflow, and a list can only speak for the package that holds it. **Some kit consumers are
> distribution packages themselves**: app-kit byte-copies `dast.yml` and `load.yml` into _its_
> consumers on every sync. Those paths were not on kit's list, so in an app-kit consumer a bump to one
> of them merged and the next `josh-app sync` wrote it straight back — the loop #836 closed, reopened
> one tier down. A shared list could not fix it either: kit's write time is the only moment kit
> controls, and at that moment it knows nothing of what app-kit distributes, so whichever `sync` ran
> last would decide the list. A stamp written by the package that overwrites the file has no such
> ordering problem, and any number of distribution tiers can each stamp their own output.
>
> **A package built on kit stamps its own files through the same helper.** kit exports it as
> `@joshuafolkken/kit/managed-marker`, taking the distributor's own package name:
>
> ```ts
> import { managed_marker_logic } from '@joshuafolkken/kit/managed-marker'
>
> const written = managed_marker_logic.apply_marker_for_destination(
> 	destination,
> 	content,
> 	'@joshuafolkken/app-kit',
> )
> ```
>
> It is exported rather than left internal because the alternative is each distributor writing the
> header itself, and a second implementation that spells the token differently or stacks a duplicate
> silently breaks the check that reads it. The check matches the token, not any particular package
> name, so every tier's stamp is recognized the same way.
>
> The stamp also draws a line the list could only describe in prose. `deploy-vps.yml` is patched by
> sync but written directly rather than through that transform, so it is never stamped and a bump to
> its own pins still merges — a property of how the file is written, not of anyone remembering to
> leave it out of a list.
>
> Two failure modes are decided on the safe side. A changed workflow that cannot be read at the pull
> request's head — deleted, rate-limited, or unreachable — fails the step rather than being answered:
> publishing no output lands on the same side as answering "managed" (the reconciling step below reads
> a missing input as "do not arm") but it lands there visibly, instead of withdrawing an auto-merge on
> a green job with nothing to look at. And the narrowing to workflow paths happens inside the `--jq`
> query rather than through `grep`, which answers `1` for "no match" and `2` for "I could not look":
> the old check read both as "not managed", and one of those readings means "merge it".
>
> **The decision is made once, and one step makes the pull request match it.** `gh pr merge --auto` is
> state that outlives the run that set it, so deciding not to arm is not the same as undoing an arm an
> earlier run performed. For four rounds this workflow carried two steps for that — one that armed and
> one that withdrew — whose conditions had to be exact complements of each other, with nothing
> enforcing the complement: joshuafolkken/kit#840 made it hold by writing one as the literal negation
> of the other, which is a convention rather than a structure. Every fix since joshuafolkken/kit#836
> had the same shape, a new axis added to several conditions at once.
>
> joshuafolkken/kit#845 replaced that with one step that changes the state, taking both directions
> from two declarations that answer two genuinely different questions — which is what the old design
> conflated:
>
> ```yaml
> MAY_ARM: >-
>   ${{ github.actor == 'dependabot[bot]'
>   && steps.managed.outputs.has-upstream-managed == 'false' }}
> SHOULD_BE_ARMED: >-
>   ${{ github.actor == 'dependabot[bot]'
>   && steps.managed.outputs.has-upstream-managed == 'false'
>   && steps.metadata.outputs.package-ecosystem == 'github_actions'
>   && (steps.metadata.outputs.update-type == 'version-update:semver-patch'
>   || steps.metadata.outputs.update-type == 'version-update:semver-minor') }}
> ```
>
> `MAY_ARM` asks whether this **run** is entitled to decide — who pushed, and whether the diff holds a
> workflow an upstream package overwrites. `SHOULD_BE_ARMED` asks whether this **bump** qualifies, and
> is `MAY_ARM` plus the ecosystem and the semver level, which are facts about the bump that do not
> change over a pull request's life. The second contains the first verbatim and a kit unit test holds
> that containment, so they cannot drift into disagreeing the way two complements could.
>
> **The distinction is what the withdrawal keys on, and it is load-bearing.** On a run that is still
> entitled, a bump that simply does not qualify — an npm security advisory, a github-actions major — is
> left exactly as it is: if a maintainer read it and enabled auto-merge by hand, that is their
> decision. Withdrawing there would strand the pull request green, mergeable and unmerged, which is the
> state joshuafolkken/kit#834 exists to prevent.
>
> What is withdrawn is an arm the **run** is not entitled to. That takes back a hand-armed auto-merge
> as well, and deliberately: a push nobody reviewed as part of the bump is exactly the case
> joshuafolkken/kit#840 closed, and who armed it earlier does not make the new commits reviewed. A
> human is overridden when merging would be harmful, and only then — falling outside this workflow's
> policy is not.
>
> The step reads what the pull request currently says before either direction, because
> `--disable-auto` is an error rather than a no-op on a pull request that has none. Arming and
> withdrawing stop being two policies that must not disagree and become two directions of one.
>
> It stays an **expression** rather than shell on purpose. Written that way, GitHub's own engine
> evaluates it and kit's unit tests evaluate the very same string with that engine — a matrix over
> actor, upstream-managed, ecosystem and semver level proves which updates can reach the arming call.
> Moved into the script it would still work, and every guard on it would decay from an evaluation into
> a substring match.
>
> **A step that could not answer publishes no outputs, and the chain that names it goes false.** The
> two chains name different inputs, which is deliberate. An upstream-managed check that refused to
> decide costs the run its entitlement, so an arm it finds is taken back. A metadata action that could
> not read the branch costs only qualification: nothing is armed now, and an arm an earlier run made is
> left alone — that run did verify the ecosystem and the semver level, and neither changes over a pull
> request's life, so withdrawing would strip a good arm every time the action has a bad day. The safe
> side is per question rather than per input: _do not arm on what I cannot verify_, and _take back what
> this run is not entitled to_.
>
> The two failures also announce themselves differently, which is why only one of them fails a step. An
> upstream-managed check that guessed would let an unreviewed bump merge and nothing would say so, so
> it fails loudly. A metadata action that cannot answer makes bumps stop merging, which announces
> itself by the pile of open pull requests; the reconciling step names it in the log as well, so a
> broken action is not mistaken for a queue of bumps that merely do not qualify. The step carries
> `if: '!cancelled()'` so it is reached after either failure; a cancelled run is left alone, because it
> changed nothing about the pull request and the run that superseded it will decide from the current
> state anyway (joshuafolkken/kit#840).
>
> **`dependabot/fetch-metadata` no longer constrains the order.** The ecosystem and the semver level
> come from an action rather than a context, and that action fails outright when the branch's first
> commit is not Dependabot's — a maintainer who amended or rebased the bump. A failed step used to take
> every step after it with it, which is why the withdrawal had to be placed ahead of it and why it had
> to repeat the arming gate to avoid running at all (joshuafolkken/kit#838). `continue-on-error: true`
> contains that failure, and both workarounds go with it. What order remains is data dependency alone.
>
> **The two directions are not equally dangerous.** Failing to arm leaves the bump open for a human —
> an inconvenience. Failing to withdraw leaves an auto-merge armed on a diff nobody re-approved, and
> this workflow is not a required check, so a red run does not hold the merge back.
>
> That asymmetry is why, of the two calls that change the state, **the arming one does not retry**. A `gh` call that
> failed once — a rate limit, a 5xx, a network blip — used to end the step where it stood, and the arm
> survived; the state read and the `--disable-auto` now each get a few attempts with a widening delay.
> The read is shared, so an arming run gets those attempts too — what it does not get is a second try
> at arming. The notice below retries on the same terms, and so does the lookup that checks whether one
> already stands.
>
> Those attempts widen the window in which a superseded run could undo an arm a newer one just made,
> from one failed call to the length of the backoff. The concurrency group above cancels such a run,
> and where it does not the outcome lands on the same safe side as every other failure here: the bump
> is left open for a human. When the read never succeeds, the
> withdrawal is attempted anyway rather than skipped, because "I could not tell" is not evidence that
> there is nothing to take back; the arming direction does the opposite and refuses, because arming on
> a state nobody could read is the one move that cannot be undone later. Arming is not retried at all:
> its failure leaves the bump open, which is where a human wanted it anyway.
>
> When the withdrawal still fails after its retries, the run **comments on the pull request**. That
> does not stop the merge — nothing in a non-required check can — but it puts the reason where the
> person looking at the merged pull request will find it, instead of leaving a red job nobody had a
> reason to open. The comment carries a marker naming the head it was written for and what the run
> established, so re-running the job after a blip does not repeat a notice that already says the same
> thing — while a failure after the branch moved, or a re-run that learned more ("confirmed armed and not
> disarmed" where only "state unknown" stood), is reported as the new information it is. The reverse is
> not: a later run that could not read the state adds nothing to a standing notice that did. The lookup
> that checks for a standing notice is the same call against the same API as the state read, so it
> cannot help when that read is what never succeeded — a lasting read outage duplicates the notice on
> each re-run, which is the better mistake when the alternative is silence.
>
> A withdrawal whose response was lost looks the same as one that failed, and the retry after it then
> fails for the honest reason that there is nothing left to disable — so before anyone is asked to
> act, the run reads the state once more and exits quietly if the pull request is not armed after all.
> That same read resolves the case where the state was never legible: a pull request that turns out
> not to be armed needs no notice. The notice is not retracted when a later run succeeds where an
> earlier one did not; it asks the reader to check, and finding it already withdrawn is the cheap end
> of that.
>
> The notice is not free: most pull requests reaching the unreadable-state path were never armed, so
> during a partial outage some of those comments ask someone to check something that turns out to be
> fine. That is the deliberate side of the trade — the silence it buys would let a genuinely armed
> auto-merge merge an unreviewed diff with nothing to read anywhere — and the notice for that case says
> the state is unknown rather than claiming it is armed. See joshuafolkken/kit#846.
>
> The same asymmetry is why only the arming call carries `--match-head-commit`, naming the head the run
> was triggered for:
> the flag reaches GitHub as the auto-merge mutation's `expectedHeadOid`, so the arm is refused if the
> branch moved since this run decided. That closes the window the concurrency group only narrows
> (joshuafolkken/kit#842). Withdrawing from a stale view costs at most an auto-merge the next run
> re-arms, so it needs no such guard.
>
> **One run at a time per pull request.** Nothing above orders the runs against each other, and GitHub
> leaves them running in parallel unless a workflow declares a `concurrency` group. Without one, a run
> that found nothing upstream-managed in the diff, was overtaken by a force-push that added one, and
> reached its arming step after the newer run had already reconciled, would arm auto-merge on a diff
> kit overwrites — with nothing left to run afterwards to undo it. Both copies therefore declare
> `group: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`, the same grouping
> `ci.yml` uses; `github.ref` is the pull request's own merge ref, so a superseded run is cancelled
> without one bump waiting on another's.
>
> In kit's **own** repository the same workflow deliberately has no upstream-managed exclusion — and so
> has nothing to withdraw, which is why it keeps a plain arming step and the narrower `github.actor`
> guard on its job. Reconciling there would newly withdraw an auto-merge a human enabled by hand, for a
> decision kit's own copy does not even make. There `.github/workflows/*` is the source of truth, so a
> bump merged in kit is precisely the update every consumer then receives.
>
> **`josh init`, `josh sync` and `josh doctor` report that workflow's prerequisite too.**
> `gh pr merge --auto` fails outright with `Auto-merge is not allowed for this repository` unless the
> repository's own **Allow auto-merge** setting is on, and that setting is off by default — so
> distributing the workflow without reporting the setting would hand every consumer a workflow that
> never merges anything. All three read the `allow_auto_merge` field of
> `GET /repos/{owner}/{repo}` and print one of three results: `enabled`, `disabled`, or
> `could not be read`. The whole repository object is requested rather than a `--jq` projection,
> because a projection cannot tell a field that is `false` from a field the response never carried —
> a token without admin access simply does not receive it. `sync` reports unconditionally; `init` and
> `doctor` report only where a workflow that calls `gh pr merge --auto` is actually present, which
> also covers a consumer's own auto-merge workflow, since it needs the same setting. When the setting
> is **off** the report prints the enabling command, addressed at the resolved repository. kit never
> runs it: changing a repository setting is outward-facing, needs admin scope, and is the
> maintainer's call — the same line joshuafolkken/kit#805 drew, which is why `josh doctor --fix` does
> not enable this either. See joshuafolkken/kit#834.
>
> **Pins are resolved when the file is written, not read from the template.** Every workflow the
> kit writes into a consumer (`josh init` and `josh sync` alike) passes through
> `workflow_pin_logic.apply_pins_for_destination`, which substitutes each `uses:` ref from the
> kit's own `.github/workflows/*` — the single source of truth. Dependabot's `github-actions`
> ecosystem can only scan `.github/workflows/**` and a root `action.yml`, so it can never update
> `templates/workflows/*`; resolving at write time is what keeps that blind spot from reaching
> consumers. A template ref that lags behind a bump is therefore harmless, and no longer fails the
> kit's own CI. See joshuafolkken/kit#747.
>
> **`.claude/settings.json` denies the commands the prompts forbid most often.** `CLAUDE.md` bans
> autonomous staging and pull request merges nobody asked for in several places, but prose is only
> honored while it is being read — so the distributed
> settings deny them mechanically, alongside the destructive commands that were already there:
>
> ```json
> "Bash(git add*)", "Bash(git stage*)", "Bash(git rm*)", "Bash(git mv*)",
> "Bash(git reset*)", "Bash(git restore --staged*)", "Bash(git restore -S*)",
> "Bash(git commit -a*)", "Bash(git commit --all*)", "Bash(gh pr merge*)"
> ```
>
> **No josh step is affected.** `pnpm josh git` and `pnpm josh followup --merge` run git and gh from
> inside node scripts, so the only command string the Bash matcher ever sees is the `pnpm josh …`
> wrapper — denying the direct forms leaves the entire commit-and-merge workflow intact. `git rm` is
> denied whole rather than as `git rm --cached`, which would leave `git rm -r --cached` through; a
> tracked file is deleted with plain `rm` and staged by `pnpm josh git`, so nothing legitimate needs
> it. `git restore <path>` is left unblocked so the documented way to undo a deletion stays
> available to whoever runs it; the two spellings that carry the index, `--staged` and `-S`, are
> denied. Unblocked is not the same as endorsed — the prose rule still has the agent ask before
> running that or any other destructive rewrite.
>
> **`git commit` is denied by flag, not as a whole.** `git commit -a` stages every tracked file and
> commits it, which is the fallback a refused `git add` pushes an agent toward, so both spellings of
> that flag are denied. Plain `git commit -m "…"` is left alone deliberately:
> `prompts/git-automation.md` — shipped to consumers in the same package — instructs the agent to run
> exactly that command, and denying it here would break a documented flow from the other half of the
> distribution. Routing that prompt through `pnpm josh git` is the change that would let the whole
> subcommand be denied, and it is a larger one than this.
>
> **It is a guardrail, not a sandbox.** Each entry is a prefix pattern, so plenty still runs: a
> global option ahead of the subcommand (`git -C . add .`), a flag pair the prefix does not cover
> (`git restore --worktree --staged <path>`), the plumbing spellings (`git update-index`,
> `git apply --cached`), and everything that stages or commits by another route (`git merge`,
> `git cherry-pick`, `git revert`). `git stash` is the notable one: the documented `fullrun new` /
> `queue` steps run it and `git stash pop` themselves, and a `pop` without `--index` reapplies
> everything unstaged, so that flow flattens a staged baseline the deny entries otherwise protect.
> Closing all of them would mean denying
> `git` itself, which takes the read-only inspection commands the prompts require with it. The deny
> stops the habitual form, which is the form an agent reaches for; the prose rule in `CLAUDE.md`
> stays the authority on intent, and a command being refused is not the boundary of what is
> forbidden.
>
> **`.claude/skills/verify-ui/` is the UI gate's implementation.** The completion gate in the rule
> AI documents says a change to the rendered screen is not done until someone has looked at it, and
> until joshuafolkken/kit#853 it named a skill this package did not ship — so the step pointed at
> nothing. The skill picks the routes, calls the application layer's own screenshot command, and
> opens the images. Where no such command exists it says so and leaves the gate open, which is the
> point: a skill that returned success there would read as closed while verifying nothing. Of the two
> commands it looks for, `josh-app shot` shipped in app-kit 0.86.0 (joshuafolkken/app-kit#200) and
> `josh-game shot` does not exist yet, so a SvelteKit project captures for real while a game project
> still takes the fallback. Which branch a project takes is decided by the command list its toolkit
> prints, never by a sentence here: this one is true of a version, and the skill is written to check
> rather than to trust it (joshuafolkken/kit#883).
>
> It is distributed as `verify-ui` rather than `verify` deliberately. Claude Code bundles a `/verify`
> of its own, and a project skill at `.claude/skills/verify/` replaces it — that path is also where
> the bundled skill records its own recipe, so `josh sync` and the recording would overwrite each
> other on every run, the same distribution loop the workflow pins had to be pulled out of. A unit
> test asserts that no `.github/workflows` path is in the directory-copy list: the copy skips the
> pin-and-stamp transform, and a workflow shipped through it would arrive unpinned and unstamped.
>
> **`.claude/skills/workflow-commands/` and `.claude/skills/dependency-update/` hold what the AI
> documents used to inline.** The rule document is read in full on every turn, and roughly
> half of it was procedure for a workflow most turns never enter — the `kickoff` / `fullrun` /
> `halfrun` / `queue` steps, the `/code-review` → `followup --merge` chain rule, and the checks that run
> after a dependency update. joshuafolkken/kit#854 moved those into these two skills and left the
> documents with the trigger, cutting each from roughly 83 KB to roughly 49 KB.
>
> **What stays resident is decided by one question — must the rule fire on a turn where no skill was
> loaded?** joshuafolkken/kit#951 wrote that criterion down after the documents grew back to within
> three bytes of their ceiling and each new rule started paying for itself by deleting a neighboring
> sentence. `.claude/skills/workflow-commands/SKILL.md` → "What stays resident, and what is read from
> here" carries the criterion and the exhaustive list of the rules that pass it; a unit test asserts
> each of them present in `CLAUDE.md`, and asserts headroom under the ceiling so the next rule is
> written while moving a procedure is still a choice. Since
> [#963](https://github.com/joshuafolkken/kit/issues/963) that is the only document those markers
> are asserted against — `AGENTS.md` and `GEMINI.md` are pointers to it, guarded instead by
> `scripts/ai-document-pointers.test.ts`, which fails if a rule body reappears in either.
>
> Their markdown does cite `prompts/…` paths, which a byte copy would have shipped unresolved — so
> the directory copy is followed by the same rewrite the file copies run, over the copied markdown
> only. A binary file under a skill is left untouched, and a `.github/workflows` path still may not
> live there: the rewrite covers markdown, not the pin-and-stamp transform.
>
> **The directory copy merges and never prunes.** `cpSync` writes the package's files over the
> consumer's and leaves everything else in place, so a file dropped from the skill upstream stays in
> the consumer until someone deletes it, and a file a consumer adds beside `SKILL.md` survives every
> sync. Deleting the destination first would be the alternative, and it would take a consumer's own
> files with it — so the merge is the deliberate half of the trade, and a removed file is something
> to announce in the release notes rather than something sync cleans up.
>
> **The same file wires the post-edit formatter.** Its `PostToolUse` hook runs
> `pnpm josh format:edited` after every `Edit` and `Write`, formatting the one file that changed
> instead of leaving an agent to run a whole-project lint to see what a single edit looked like. It
> reaches a consumer the same way the deny list does, and `docs/josh-commands.md` documents what the
> command does and why it never fails.
>
> **The trade-off is deliberate.** A deny entry has no exception for "the user asked for it in this
> turn", so the one case the prompts allow — an explicit staging instruction — is blocked too. It is
> blocked only for the agent: the user runs `git add` in their own terminal unchanged. A permanent
> mechanical guarantee is worth more than an exception that costs one command to work around. See
> joshuafolkken/kit#850.

### `pnpm-workspace.yaml` (merged)

`pnpm-workspace.yaml` is **merged**, not overwritten. Your existing file is the base: all top-level keys it already has (user-added keys like `packages:`, and any value you already set on a managed key) are preserved as-is. Kit-managed keys the template introduces (`minimumReleaseAgeExclude`, `allowBuilds`, `overrides`, `trustLockfile`) are appended only when missing.

`trustLockfile: true` skips pnpm 11.5's install-time supply-chain re-verification of the committed lockfile. Without it, clean CI environments (e.g. Cloudflare Workers Builds) that cannot authenticate private `@joshuafolkken/*` GitHub Packages hit a false `ERR_PNPM_TARBALL_URL_MISMATCH`. `minimum-release-age` still applies at resolution time, so age-based supply-chain protection is preserved.

### File mappings (overwritten if source exists)

These are fully-managed files whose package source has a different name than the destination. They are byte-copied on every sync (consumers do not hand-edit them):

| Package source                                  | Destination                                   |
| ----------------------------------------------- | --------------------------------------------- |
| `templates/workflows/ci.yml`                    | `.github/workflows/ci.yml`                    |
| `templates/workflows/dependabot-auto-merge.yml` | `.github/workflows/dependabot-auto-merge.yml` |

If the source file does not exist in the installed package, the destination is skipped with a warning.

> `.gitignore` used to be a byte-copy mapping here, which wiped project-local entries on every sync. It is now **union-merged** instead — see the merged-config table below.

### `sonar-project.properties` (regenerated)

The Sonar config is regenerated from the current GitHub repo name (fetched via `gh repo view`). If `gh` is unavailable or the repo cannot be identified, this file is skipped with a warning.

The project key and organization are derived from the `owner/repo` slug:

- `project_key` → `owner_repo` (slash replaced with underscore, lowercased)
- `organization` → `owner` (lowercased)

### Config files (merged, only when already present)

These files are created by `josh init`. `josh sync` refreshes them in place by reusing the same merge functions `init` uses — never created on first run, so projects that opted out stay opted out. Each handler is idempotent: when the file is already current, it logs `unchanged` and skips the write.

`.secretlintrc.json` is the one exception: it **is** created when missing, because the pre-commit secret scan it configures ships to every consumer through `lefthook/base.yml` and cannot run without it. There is no opt-out to preserve — a project that predates the rule simply has no such file yet.

| File                      | Merge strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Append any missing kit ignore patterns; consumer-local entries are preserved. Matching is per-line and comments/blank lines are skipped, so re-running is a no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `.npmrc`                  | Append-only: any missing line from the kit's required-lines list is added and every existing line is kept verbatim. A `//npm.pkg.github.com/:_authToken=…` line is **not** removed, in either the literal or the `${NODE_AUTH_TOKEN}` form. The kit does not distribute the credential line (pnpm ignores an env-var credential from a project `.npmrc` unless `npmrcAuthFile` declares the file trusted, so distributing it would only warn), but a consumer that has opted in owns a live credential there — and the opt-in commonly lives in a deploy platform's dashboard, invisible to sync. Kit `< 1.60.0` stripped it and broke such deploys; see [authentication.md §4(d)](./authentication.md#4-build-platforms-with-no-user-level-npmrc)                                 |
| `eslint.config.js`        | Overwrite with the current kit template (no merge — same model as Playwright)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tsconfig.json`           | Rewrite a retired `@joshuafolkken/*/tsconfig/*.jsonc` preset path to `.json`, then prepend the kit preset to the `extends` array — unless an `@joshuafolkken/*` tsconfig preset that already embeds kit base is present (e.g. app-kit's `tsconfig/sveltekit.json`) — then strip any `compilerOptions` key whose value equals the kit base preset (removing it as empty); value-divergent overrides and `include` are preserved, and the generated-output directories (`playwright-report`, `test-results`, plus `node_modules` / `build` / `dist`) and SvelteKit's `src/service-worker*` exclusions are union-merged into `exclude`. Rewrites are emitted prettier-clean (arrays are laid out the way prettier would — inline while they fit, one entry per line once they do not) |
| `cspell.config.yaml`      | Prepend the kit import to the `import:` list, unless already present or superseded by an `@joshuafolkken/*` cspell preset that already imports kit base (e.g. app-kit's or game-kit's import)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `lefthook.yml`            | Prepend the kit preset to the `extends:` list — unless an `@joshuafolkken/*` lefthook preset that already extends kit base is present (e.g. app-kit's `lefthook/sveltekit.yml`); adding a second kit-base extend would crash lefthook with a "possible recursion in extends" error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `.secretlintrc.json`      | Created when absent; an existing file is never rewritten, because its rule list becomes project-owned (custom patterns, deliberate exclusions) once written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `package.json`            | Add the `secretlint` / `@secretlint/secretlint-rule-preset-recommend` devDependencies when missing, so projects initialized before the secretlint pre-commit rule can run it. A version the consumer already pinned is never changed. Until the following `pnpm install` lands the packages, the hook skips with a notice rather than blocking the commit                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.vscode/extensions.json` | Append missing kit recommendations to `recommendations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `.vscode/settings.json`   | Add missing top-level keys; for a key the project already owns, merge in kit's missing entries when both values are objects (a project entry always wins over kit's). Array- and scalar-valued keys the project owns are never touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

Every rewrite above is emitted the way prettier would format that particular file, so a file kit edits never fails the project's own `prettier --check`. This is per-filename, not one rule: prettier formats `package.json` with its `json-stringify` printer, which puts every array element on its own line no matter how short the array, while `tsconfig.json` and `.vscode/*.json` go through the `json` printer, which keeps a short array inline. kit writes each accordingly — see [kit#797](https://github.com/joshuafolkken/kit/issues/797), where the tsconfig rule was applied to `package.json` and inlined arrays like `keywords` that prettier then demanded back.

Object-valued settings are registries of independent entries (`files.associations`, `editor.codeActionsOnSave`, the per-language `[typescript]` blocks), so sync merges them one entry at a time: kit's entries are added, and any entry the project already declares keeps its own value. Without this, a project that customized such a key for one reason would silently never receive any later kit addition inside it. Arrays stay create-only — combining a list like `eslint.validate` would be a guess about intent, and overwriting it would drop the project's own entries.

### tsconfig normalization

`josh sync` keeps consumer `tsconfig.json` files minimal: any `compilerOptions` key whose value already equals the kit base preset (`base.json`) is redundant — the preset supplies it via `extends` — so sync removes it. A key whose value **differs** from the base (e.g. a library's `noEmitOnError: false`) is an intentional override and is preserved — sync cannot tell a necessary override from an unnecessary one, so it conservatively keeps every value-divergent key. `include` and project-specific keys the base does not define are also left untouched; `exclude` is union-merged (next section).

### tsconfig exclude — generated output and SvelteKit exclusions

`josh sync` union-merges `node_modules`, `build`, `dist`, `playwright-report`, `test-results` and SvelteKit's six `src/service-worker*` globs into the consumer `exclude`: entries the project authored are kept verbatim, only missing ones are appended, and a re-sync on an already-merged file is a no-op.

The reason it is a merge rather than a create-only write: every existing consumer already has a `tsconfig.json`, so a strategy that only writes new files would leave the whole installed base type-checking Playwright's generated report. `playwright.config.ts` points the `html` reporter at `playwright-report/`, which holds Playwright's own minified trace-viewer bundle — a project with a broad `include` gets thousands of `tsc --noEmit` errors from third-party output right after running the E2E suite kit ships the config for. The report directory cannot simply live under the already-ignored `test-results/`: Playwright rejects an HTML output folder nested inside the tests output folder (and vice versa) as a configuration error, so both directories are excluded instead.

The entries must land in the **consumer** file: a `tsconfig.json` `exclude` **overrides** the extended preset's rather than merging with it, so putting them in `base.json` — or in app-kit's `tsconfig/sveltekit.json` — would have no effect on any project that declares its own. Declaring `exclude` also disables TypeScript's implicit exclusion of `outDir`, so a project with a custom `outDir` outside `build` / `dist` should add it to the list.

That same override rule is why the `src/service-worker*` globs are merged in as well. A SvelteKit project extends `./.svelte-kit/tsconfig.json`, which excludes those paths itself, and writing any `exclude` key into the consumer file replaces that array outright — so before [kit#796](https://github.com/joshuafolkken/kit/issues/796) all six were silently discarded, and a project that later added `src/service-worker.ts` got a type-check failure several layers away from the file it just wrote. Repeating them makes the merged list additive. They are merged unconditionally — kit has no SvelteKit detection — and in a non-SvelteKit project they usually match nothing; the exception, a project that keeps its own `src/service-worker.ts`, is covered in [init.md → tsconfig exclude](./init.md#tsconfig-exclude).

A merge which has something to append rewrites **only the value it changes**. Every other byte of the file — comments, key order, trailing commas, your own indentation — is passed through untouched, so the `// Path aliases are handled by ...` block `sv create` ships survives a sync. Until [kit#798](https://github.com/joshuafolkken/kit/issues/798) these merges parsed the document and wrote the whole thing back from the parsed object, which silently deleted every comment in it.

Two consequences worth knowing:

- **kit no longer reformats a file it did not author.** A `tsconfig.json` that arrives prettier-clean leaves prettier-clean, because the value kit splices in is rendered the way prettier would render it at that position. One that arrives badly formatted keeps its own layout rather than being quietly normalized — that is the same trade that lets your comments survive, and your own `prettier --write` is the tool for it. The one exception is a missing final newline, which is added back.
- **A comment inside the value being replaced still goes.** Editing `exclude` rewrites the `exclude` array and nothing else, so a comment sitting inside that array is lost while comments around it survive. Redundant `compilerOptions` keys are pruned one at a time precisely so this does not take the whole block's comments with them.

### tsconfig preset extension migration

kit-family tsconfig presets shipped as `*.jsonc` until kit 1.23. Playwright ≥ 1.62 appends `.json` to any `extends` entry that does not already end in it and then throws when the resulting path is missing, so a `.jsonc` preset resolved to `*.jsonc.json` and `playwright.config.ts` failed to load at all — the whole E2E suite could not start. The presets are now shipped as `*.json`, and `josh sync` rewrites any `extends` entry matching `@joshuafolkken/*/tsconfig/*.jsonc` to the `.json` path so an upgrading consumer is repaired automatically. Only kit-family preset paths are rewritten; a project-local `.jsonc` config is left untouched. A tsconfig is parsed as JSONC regardless of extension, so comments in the preset still work.

### Ecosystem-preset dedup (app-kit / game-kit consumers)

kit's base layer for `tsconfig.json`, `cspell.config.yaml`, and `lefthook.yml` is added only when the consumer does not already reference an `@joshuafolkken/*` preset for that subsystem. Every ecosystem preset — kit's own base, or an app-kit / game-kit framework preset — embeds, imports, or extends kit base by construction, so a second kit-base reference would be redundant (cspell / tsconfig) or a hard crash (`lefthook.yml` extends `lefthook/base.yml` twice → "possible recursion in extends"). The check reads the consumer's own config content — not its dependency tree — so it works for any current or future `@joshuafolkken` overlay without a hardcoded package name.

## Path transformation

`CLAUDE.md` and other AI files contain references to `prompts/` files. `josh sync` rewrites these paths so they point to the correct location in `node_modules`. The `AGENTS.md` / `GEMINI.md` pointers are rewritten by the same pass ([#963](https://github.com/joshuafolkken/kit/issues/963)): each one tells the reader to open `prompts/*.md` when `CLAUDE.md` names one, and that citation has to resolve in a consumer like any other:

```text
`prompts/foo.md`  →  `node_modules/@joshuafolkken/kit/prompts/foo.md`
```

This transformation is applied to backtick-quoted paths matching the pattern `` `prompts/<path>` ``.

## Refused inside the distribution package's own repository

`josh sync` and `josh init` both write nothing and exit non-zero when the project they are aimed at
**is** the package that distributes the files:

```text
Refusing to sync: this is @joshuafolkken/kit's own repository.
Syncing here would overwrite the distribution source with its own derived templates.
Run this command from a consumer project instead.
```

Inside the source repository every copy runs backwards. The mapped workflows are written from
`templates/workflows/` over `.github/workflows/`, which is the authoritative side the pins are
resolved _from_ ([#747](https://github.com/joshuafolkken/kit/issues/747)); the path transformation
rewrites the package's own `` `prompts/…` `` references to `node_modules/@joshuafolkken/kit/prompts/…`,
where nothing resolves; and `tsconfig.json` is pointed at a copy of kit inside kit. Reproduced on a
clean checkout in [#868](https://github.com/joshuafolkken/kit/issues/868): 14 files, `CLAUDE.md`,
`AGENTS.md`, `GEMINI.md` and both mapped workflows among them.

The project is recognized by the `name` in its `package.json` matching the running package's own
name, with two fallbacks for when no manifest can be read there: an identical package/project
directory, and a project root that sits **inside** the package directory (`pnpm josh sync` run from
`kit/docs`). Only that direction refuses — the reverse is the ordinary consumer layout, where the
package always lives at `<project>/node_modules/@joshuafolkken/kit`. The name is what carries the
check: the incident that prompted it ran a **globally installed** copy against the source
repository, so the two directories were unrelated and only the name matched. A downstream
distributor syncing its own upstream — app-kit running kit's base sync inside the app-kit repository
— is an ordinary consumer sync and is not affected.

`josh init` is guarded for the same reason and by the same check
([#879](https://github.com/joshuafolkken/kit/issues/879)). It calls the sync writers directly rather
than through `josh sync`, so the guard on the sync entry point never covered it — and its blast
radius is the larger of the two: on top of the files above it rewrites the project's `package.json`
scripts and devDependencies. See [init.md](./init.md#refused-inside-the-packages-own-repository).

The detection ships as the `@joshuafolkken/kit/self-sync-guard` export so app-kit and game-kit apply
the same rule rather than each re-implementing it.

## What does NOT get synced

- `package.json` — largely init-only to avoid clobbering project version / dependencies. To refresh kit-managed scripts or dev-dependency pins, re-run `josh init`. The one exception: `sync` realigns `devEngines.packageManager.version` with the whole `packageManager` pin, `+sha512…` Corepack integrity suffix included (pnpm compares the two as raw strings, so any drift — including a stripped suffix — reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning); scripts, dependencies, and the project version are never touched.

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/kit` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset AI files (`CLAUDE.md`, `AGENTS.md`, etc.) to the latest package version after local edits
