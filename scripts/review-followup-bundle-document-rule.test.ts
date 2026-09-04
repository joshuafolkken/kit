import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_unwrapped, WORKFLOW_PROMPT } from './ai-document-fixture'

// joshuafolkken/kit#946: the review round cap's follow-up filing said "file it and reference the
// current Issue" and stopped there. Connecting the new Issue to an epic was a rule in a different
// document, with no route to it from the filing steps — so followed literally, the procedure ends
// with an Issue no epic tracks. `epic:next` only ever offers a child an epic's task list names, so a
// running `epicrun` is never handed that Issue: the deferred finding is not dropped, it is parked
// forever. Measured on #943 (filed with a parent written in its body, tracked by no epic, parent
// closed three minutes later) against #911 (same route, command was run, Issue was added).
//
// The markers pin the parts a reword loses first: that filing alone is not finished, the write
// command each Tier A answer needs (`epic:bundle` itself writes nothing), that `ask` is decided and
// recorded rather than stopping or parking, that the bundle has to run before the parent closes, and
// that a `none` printed after a truncation warning is not an answer.

const REVIEW_PROMPT = 'prompts/review.md'
const SKILL_ROOT = '.claude/skills/workflow-commands'
const ENTRY_SKILL = `${SKILL_ROOT}/SKILL.md`
const BUNDLE_COMMAND = 'pnpm josh epic:bundle <new>'
const BUNDLE_COMMAND_QUOTED = `\`${BUNDLE_COMMAND}\``
// The one-line form the resident documents and the two skill files share, so a reword that drops the
// tier from any one of them fails rather than leaving three copies saying different things.
const TIER_A_ANSWER =
	'`add_to_epic` / `create_epic` are Tier A, executed with the matching `pnpm josh epic --add` / `pnpm josh epic` write command and never a hand edit of the epic body'
// joshuafolkken/kit#1082: the one-line routing clause the resident triggers and the turn-end
// self-check share — a copy left on the blanket "file everything" rule fails against it.
const THREE_WAY_ROUTE = 'route each remaining non-High finding through the three-way disposition'

// The two entry points that state the filing step in the skill. `halfrun` and `queue` state the cap
// but route the filing itself through these, so they are deliberately not in this list.
const FILING_SKILLS: ReadonlyArray<string> = [
	`${SKILL_ROOT}/chain-rule.md`,
	`${SKILL_ROOT}/fullrun.md`,
]

// joshuafolkken/kit#1082: the blanket "file every non-High finding" rule made the round cap the
// largest follow-up-Issue manufacturing line — six Issues to correct three comments that changed no
// executable line. It is replaced by a three-way disposition decided from the finding, not the
// filer's discretion: fix-in-place (never a new review round), file, or drop with a one-line PR note.
// The markers pin the three exits, the fix-in-place round-cap ceiling, the same-root bundling rule,
// and that only the file branch reaches the filing procedure below — so a reword cannot quietly
// collapse it back to the blanket rule this Issue removed.
const THREE_WAY_MARKERS: ReadonlyArray<string> = [
	'### Three-way disposition after the cap',
	"**A finding's disposition is decided from what it is, mechanically — not from the filer's discretion.**",
	'**Fix it in place.**',
	'**A fix-in-place never starts a new review round.**',
	'**File it as an Issue.**',
	'**Drop it with a one-line note in the PR body.**',
	'extended past the round cap — the two documents no longer disagree about what happens to a Low',
	'**Findings that reduce to one root judgement are filed as one Issue, not several.**',
	'Only branch 2 files an Issue.',
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	...THREE_WAY_MARKERS,
	'**Filing does not end at the Issue.**',
	BUNDLE_COMMAND_QUOTED,
	// `epic:bundle` writes nothing, so "execute the answer" is unactionable without the write
	// command — and a hand edit of the epic body is the one thing that breaks `epic:next` outright.
	'**`epic:bundle` recommends and writes nothing**',
	'`pnpm josh epic --add <E> <new>`',
	'`pnpm josh epic "<title>" <new> <other> [--ordered]`',
	'never a hand edit of the epic body',
	// joshuafolkken/kit#1339: `ask` used to stop a run and park a child inside an `epicrun`, which
	// halted a whole batch over where a follow-up Issue was filed while its implementation was
	// finished and its pull request mergeable. Placing an issue is reversible in one `epic --add`, so
	// the answer is decided and recorded instead — and the record is what a reword loses first.
	'**This does not stop a run and does not park a child**',
	'record the decision** — what was taken, what was rejected, why, and the date',
	// Order matters: the candidate search reads open issues only, so bundling after the parent
	// closes reproduces exactly the failure this rule exists to prevent.
	'**before the current Issue closes.**',
	'the command answers `none` permanently',
	// Without this the rule reads as tidiness rather than the failure it prevents.
	'it is parked forever, which reads the same from the backlog',
	// `epicrun #<N>` accepts a bare Issue, so "never reaches an unattended run" was too strong: what
	// is true is that `epic:next` never offers it, and a person has to know the number.
	'picking it up takes a person who already knows its number',
	// Without this the headline reads as a guarantee the tool cannot give: a standalone pre-commit
	// review files an Issue with nothing to reference, so `none` is the correct answer there.
	'**`none` is a real answer, not a failure.**',
	// `epic:bundle` can print `none` with exit 0 after truncating its epic listing, so "no answer" and
	// "nothing to bundle" look identical (joshuafolkken/kit#950). Without this row the procedure reads
	// the incomplete search as an answer and files the Issue into no epic — the failure it closes.
	'**The command could not answer**',
	'is not "nothing to bundle"',
	'never that an epic is found',
	// The evidence. Both halves are needed: the failure, and the same route succeeding when the
	// command was run — which is what makes it a missing step rather than a broken tool.
	'joshuafolkken/kit#943',
	'joshuafolkken/kit#911',
	'The only difference was whether the command was run',
]

// joshuafolkken/kit#1239: the filing and the bundle used to run before the commit, so their seconds
// were the run's own — `epic:bundle` 43s and `epic --add` 18s on kit#1229 — while the CI wait that
// follows had nothing beside it: 78 of the 122 seconds kit#1238's `followup --merge` took. Neither
// step changes a line of code, so running them after the pull request is open leaves the CI already
// running valid, and the bundle's only deadline is met because the parent Issue closes at the merge.
//
// The markers pin the placement and the distinction a reword collapses first: this is not kit#1216's
// rejected "review during CI", which would overlap work that *does* change code and pay the overlap
// back through a restarted CI on every pushed fix.
const CI_WAIT_PLACEMENT = 'inside the CI wait'

const CANONICAL_PLACEMENT_MARKERS: ReadonlyArray<string> = [
	`**The three steps run ${CI_WAIT_PLACEMENT}, not before the commit.**`,
	'after `pnpm josh git -y` and before `pnpm josh followup --merge`',
	// Without this the move reads as relaxing step 2 rather than as satisfying it elsewhere.
	'**The deadline is unchanged**',
	'**This is not "review during CI", which was decided against.**',
	'that would overlap work which **changes code**',
]

const WORKFLOW_PROMPT_PLACEMENT_MARKERS: ReadonlyArray<string> = [
	'**3 段は CI 待ちの中で実行する。コミットの前ではない。**',
	'`pnpm josh git -y` の後・`pnpm josh followup --merge` の前に置く',
	'**期限は変わらない**',
	'**これは「レビューを CI と並走させる」ではない。**',
]

// The three files that spell the pipeline out as an ordered list of commands, each paired with the
// chain as that file writes it. **The pairing is what pins the order**: asserting the two commands
// and the phrase separately passes on a file that puts the filing in front of `git -y` and still
// calls it the CI wait, which is the one arrangement this change exists to rule out. Each entry is
// therefore the literal chain, filing included, from `git -y` through to `followup`.
const PIPELINE_CHAINS: ReadonlyArray<readonly [string, string]> = [
	[
		`${SKILL_ROOT}/chain-rule.md`,
		'`pnpm josh git -y` → the follow-up filing and `pnpm josh epic:bundle` → `pnpm josh followup --merge`',
	],
	[
		`${SKILL_ROOT}/fullrun.md`,
		'`pnpm josh git -y` → **the follow-up filing and `pnpm josh epic:bundle`, run here so they sit inside the CI wait** → `pnpm josh followup --merge`',
	],
	[
		`${SKILL_ROOT}/queue.md`,
		'`pnpm josh git -y "<title> #<N>"` → the follow-up filing and `pnpm josh epic:bundle` for whatever the round cap routed to branch 2, placed here so it runs inside the CI wait',
	],
]

// The canonical prompt is what a Gemini or Cursor run reads; it never loads a Claude Code skill.
const WORKFLOW_PROMPT_MARKERS: ReadonlyArray<string> = [
	'### 後追い Issue は起票した直後に EPIC へ束ね直す',
	'`pnpm josh epic:bundle <新規>` を実行する',
	'**`epic:bundle` は推奨するだけで何も書き込まない**',
	'`pnpm josh epic --add <E> <新規>`',
	// joshuafolkken/kit#1339: the canonical prompt carried the park too, so leaving it here would have
	// the extended reference contradict the skills the moment either is reread.
	'停止もせず park もしない**',
	'所属先を選ぶことは epic の統合ではない',
	'**現在の Issue が閉じる前に** `pnpm josh epic:bundle <新規>` を実行する',
	'**逆に、実行せずに起票だけで終えると、指摘は落ちるのではなく永久に park される。**',
	'**差は、コマンドを打ったかどうかだけだった**',
	'**`none` は正当な答えである。**',
	'`epic:next` が返すのは EPIC のタスクリストにある子だけなので',
	'**コマンドが答えられなかった**',
	'**警告の後の `none` は「束ねる相手が無い」ではない**',
	// The `fullrun` section states the same step a second time; it was the copy kit#946's first review
	// found still ending at "file it", 15 lines above the one that had been updated.
	'**現在の Issue が閉じる前に `pnpm josh epic:bundle <新規>` を実行して答えに従う**',
	// The other half of the defect is a separate child; a section that did not say so would read as
	// a complete fix and leave the second cause unowned.
	'joshuafolkken/kit#947 が扱う',
]

// Read from each document itself, not from the rule surface: the surface concatenates every skill,
// so a marker checked there would pass on the skill's copy alone — which is exactly the drift the
// three paired documents exist to prevent.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	// joshuafolkken/kit#1082: the resident copy states the three-way disposition as its trigger and
	// routes to the canonical cap for the detail, and it reconciles the "Low may be skipped" line with
	// branch 3 in the same document so the two no longer contradict.
	"the same disposition the round cap's branch 3 extends past the second round",
	'place each remaining non-High finding in one of three exits',
	'**a fix-in-place never starts a new review round**',
	'Findings that reduce to one root judgement are filed as **one** Issue with a section per symptom',
	THREE_WAY_ROUTE,
	'**Filing does not end at the Issue**',
	BUNDLE_COMMAND_QUOTED,
	// The bundle has to happen while the parent is open, and before the current work completes.
	'**before the current Issue closes**',
	'act on its answer before completing the current work',
	'`epic:next` never offers an Issue no epic tracks',
	// The resident copy is the trigger and the route; the tiers and write commands are one hop away,
	// which is what keeps the always-loaded surface under its ceiling.
	'Which answers are Tier A, the write command each one needs, and what an `epicrun` does with `ask`',
	// The completion-gate copy is a second, shorter statement of the same step.
	'on it before this Issue closes and act on its answer, and complete the current Issue',
]

describe(`${REVIEW_PROMPT} — the canonical filing step`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// joshuafolkken/kit#1082: the turn-end self-check states the same disposition in one line. It must
	// route non-High findings through the three-way disposition — not the blanket "file everything"
	// rule this Issue replaced — and still bundle a finding it files. A copy left on the blanket rule,
	// beside the new canonical section, is exactly the drift this marker now catches.
	it('carries the three-way disposition in the turn-end self-check too', () => {
		expect(content).toContain(THREE_WAY_ROUTE)
		expect(content).toContain(`run \`${BUNDLE_COMMAND}\` on it`)
	})
})

describe(`${REVIEW_PROMPT} — the filing runs inside the CI wait`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_PLACEMENT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${WORKFLOW_PROMPT} — the extended reference states the placement`, () => {
	const content = read_unwrapped(WORKFLOW_PROMPT)

	it.each(WORKFLOW_PROMPT_PLACEMENT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe.each(PIPELINE_CHAINS)(
	'%s — orders the filing after the pull request',
	(skill_path, chain) => {
		const content = read_unwrapped(skill_path)

		it('writes the chain with the filing between `git -y` and `followup`', () => {
			expect(content).toContain(chain)
		})

		it('says the placement is the CI wait', () => {
			expect(content).toContain(CI_WAIT_PLACEMENT)
		})
	},
)

// The one contradiction the placement edit sat on top of: this file said the review runs *after* the
// commit, while its own section heading below — pinned by `chain-rule-document-rule.test.ts` — says
// before. The filing moved; the review did not.
describe('prompts/collaboration-workflow/plan-comment.md — the review still precedes the commit', () => {
	const content = read_unwrapped('prompts/collaboration-workflow/plan-comment.md')

	it('no longer says the review runs after the commit', () => {
		expect(content).not.toContain('コミット後かつ `pnpm josh followup --merge` 実行前')
	})

	it('places the filing after the pull request instead', () => {
		expect(content).toContain(
			'**この起票と束ね直しは `pnpm josh git -y` の後・`pnpm josh followup --merge` の前に置く**',
		)
	})
})

describe(`${WORKFLOW_PROMPT} — the extended reference agrees`, () => {
	const content = read_unwrapped(WORKFLOW_PROMPT)

	it.each(WORKFLOW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe.each(FILING_SKILLS)('%s — states the step where the filing happens', (skill_path) => {
	const content = read_unwrapped(skill_path)

	it.each([
		// joshuafolkken/kit#1082: without this the suite only pins markers the blanket rule carried too,
		// so a revert of either skill to "file every remaining non-High finding" would pass — the exact
		// copy-vs-canonical drift this Issue closes. Pinning the route clause makes that revert fail here.
		THREE_WAY_ROUTE,
		BUNDLE_COMMAND,
		TIER_A_ANSWER,
		'before this Issue closes',
		// joshuafolkken/kit#1339: `ask` no longer stops a run or parks a child. What each skill has to
		// carry now is the pair that replaced it — the choice and the record — because a skill that
		// keeps only the choice authorizes an unattended decision nobody can audit afterwards.
		'`ask` is Tier A too',
		"record the decision on both the new Issue and that epic's `## Decisions`",
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The route back to the full form. Both files state the step in one sentence; a reader who needs
	// the reasoning has to be able to reach it.
	it('routes to the canonical cap', () => {
		expect(content).toContain('"Review round cap"')
	})
})

describe.each(AI_DOCS)('%s — carries the step where it is always loaded', (document_path) => {
	const content = read_unwrapped(document_path)

	it.each(AI_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// A pre-commit self-review runs outside any workflow, so this step has to hold on a turn where
	// no skill was loaded — which is the residency criterion joshuafolkken/kit#951 wrote down. The
	// skill's list of resident rules claims to be exhaustive, so it has to name this one.
	it('is named in the resident-rule list the criterion keeps', () => {
		expect(content).toContain('as does the follow-up filing step in Pre-commit Self-Review')
	})
})

describe(`${ENTRY_SKILL} — the residency list names this rule`, () => {
	const content = read_unwrapped(ENTRY_SKILL)

	it.each([
		'**The follow-up filing step after the review round cap**',
		'A pre-commit self-review runs outside any workflow as readily as inside one',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The procedure names four answers; `epic:bundle` is what actually returns them. A documented
// vocabulary that drifts from the tool's leaves the run matching on a string the command never
// prints, and every branch falls through to "do nothing" — the silent failure this Issue is about.
// The union is asserted whole rather than per member: an extra action added to the type is exactly
// the drift this catches, and four `toContain` calls for four substrings of one line would not.
describe('the documented answers are the ones the command returns', () => {
	it('matches the BundleAction union exactly', () => {
		expect(read_repo_file('scripts/epic/epic-bundle.ts')).toContain(
			`type BundleAction = 'add_to_epic' | 'create_epic' | 'ask' | 'none'`,
		)
	})
})
