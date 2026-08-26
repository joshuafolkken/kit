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
// command each Tier A answer needs (`epic:bundle` itself writes nothing), that `ask` stops outside an
// `epicrun` and parks inside one, that the bundle has to run before the parent closes, and that a
// `none` printed after a truncation warning is not an answer.

const REVIEW_PROMPT = 'prompts/review.md'
const SKILL_ROOT = '.claude/skills/workflow-commands'
const ENTRY_SKILL = `${SKILL_ROOT}/SKILL.md`
const BUNDLE_COMMAND = 'pnpm josh epic:bundle <new>'
const BUNDLE_COMMAND_QUOTED = `\`${BUNDLE_COMMAND}\``
// The one-line form the resident documents and the two skill files share, so a reword that drops the
// tier from any one of them fails rather than leaving three copies saying different things.
const TIER_A_ANSWER =
	'`add_to_epic` / `create_epic` are Tier A, executed with the matching `pnpm josh epic --add` / `pnpm josh epic` write command and never a hand edit of the epic body'

// The two entry points that state the filing step in the skill. `halfrun` and `queue` state the cap
// but route the filing itself through these, so they are deliberately not in this list.
const FILING_SKILLS: ReadonlyArray<string> = [
	`${SKILL_ROOT}/chain-rule.md`,
	`${SKILL_ROOT}/fullrun.md`,
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'**Filing does not end at the Issue.**',
	BUNDLE_COMMAND_QUOTED,
	// `epic:bundle` writes nothing, so "execute the answer" is unactionable without the write
	// command — and a hand edit of the epic body is the one thing that breaks `epic:next` outright.
	'**`epic:bundle` recommends and writes nothing**',
	'`pnpm josh epic --add <E> <new>`',
	'`pnpm josh epic "<title>" <new> <other> [--ordered]`',
	'never a hand edit of the epic body',
	// `ask` stopping is correct everywhere except inside an `epicrun`, which parks instead of
	// stopping — without the carve-out one Tier B answer halts the whole batch.
	'**Inside an `epicrun`, park the child with `needs-decision` and continue**',
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

// The canonical prompt is what a Gemini or Cursor run reads; it never loads a Claude Code skill.
const WORKFLOW_PROMPT_MARKERS: ReadonlyArray<string> = [
	'### 後追い Issue は起票した直後に EPIC へ束ね直す',
	'`pnpm josh epic:bundle <新規>` を実行する',
	'**`epic:bundle` は推奨するだけで何も書き込まない**',
	'`pnpm josh epic --add <E> <新規>`',
	'**`epicrun` 中はバッチを止めず、その子に `needs-decision` を付けて park する**',
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

	// The chain-rule copy inside the review prompt states the same filing step in one line. A copy
	// that stops at "file it" is the instruction this Issue replaces, sitting beside the new one.
	it('carries the step in the turn-end self-check too', () => {
		expect(content).toContain(
			`file every remaining Low/Medium finding as a follow-up Issue, run \`${BUNDLE_COMMAND}\` on it`,
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
		BUNDLE_COMMAND,
		TIER_A_ANSWER,
		'before this Issue closes',
		'parks the child inside an `epicrun`',
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
