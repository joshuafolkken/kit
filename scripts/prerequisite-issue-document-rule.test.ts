import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from './git/issue-labels'

// joshuafolkken/kit#891: "something else has to land first" is the third thing a run can discover,
// and it was the only one with no procedure. The two it sits between — an upstream defect, a split —
// both end in a stop, so the nearest written rule was the one that parks. Parking a prerequisite
// that `blocked-by` could express is what makes an unattended run need a person: `needs-decision` is
// cleared by hand. These markers pin the parts a reword most easily loses — that the run does *not*
// park, the condition under which it may, and the ceiling that replaces the removed confirmation.

const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'
const FULLRUN_SKILL = '.claude/skills/workflow-commands/fullrun.md'
const HALFRUN_SKILL = '.claude/skills/workflow-commands/halfrun.md'
const SPLIT_SKILL = '.claude/skills/workflow-commands/split-assessment.md'
const STOPPING_ENTRY_SKILLS: ReadonlyArray<string> = [FULLRUN_SKILL, HALFRUN_SKILL]
const PARK_ONLY_FOR = 'Parking is only for a prerequisite that cannot be expressed as a dependency'
// A stash without `-u` leaves the new `*.test.ts` behind, which is the whole failure the step names.
const UNTRACKED_REQUIRED = '**`-u` is not optional**'

// Prose is re-wrapped by the formatter, so a marker that happens to span a line break would fail on
// a reflow that changed nothing. Matching against collapsed whitespace pins the words, not the
// column they landed in.
function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

// Read from the document itself rather than from the rule surface: the surface concatenates every
// distributed skill, so a marker checked there would pass on the skill's copy alone — which is
// exactly the drift these three paired documents exist to prevent.
//
// Only the rule is pinned here, never the procedure. The mechanics — the stash, the `--ordered`, the
// `in-progress` removal — are asserted in the skill suites below, because `workflow-skills.test.ts`
// caps how much may stay resident and inlining them there is what the cap exists to stop.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'A prerequisite discovered mid-run is a dependency, not a park',
	'continues rather than parking it',
	PARK_ONLY_FOR,
	'caps automatic filing at 10 Issues per run',
	'実行中に前提 Issue が判明した場合',
]

// The load-bearing parts of the definition, in the canonical reference.
const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'## 実行中に前提 Issue が判明した場合',
	// The distinction from the two adjacent rules is the reason this section exists at all.
	'これは分割ではない',
	'park しない',
	'park は依存として表現できない場合に限る',
	// Without this sentence the inversion reads as a preference rather than the defect it is.
	'park したことで人が必要になる',
	'この停止は残す',
	'Please run `epicrun #<E>` to execute this epic.',
	'**`--ordered` は必須であって好みの問題ではない。**',
	'blocker を見る前に',
	'git stash push -u -m',
	'**`-u` は省略できない。**',
	'stash を pop させるのはこの Issue コメントである',
]

// The command is what makes the `epicrun` branch possible; without it the procedure is "edit the
// body", which is the state joshuafolkken/kit#890 exists to remove.
const TOOL_MARKERS: ReadonlyArray<string> = ['pnpm josh epic --add <E> <N> --before <M>']

// The ceiling, matched with its row text rather than a bare `10`, which appears throughout.
const GUARD_MARKERS: ReadonlyArray<string> = [
	'自動起票の上限は全入口で 10 件',
	'確認という歯止めを外す以上、上限を付ける',
]

const EPICRUN_SKILL_MARKERS: ReadonlyArray<string> = [
	'## A prerequisite discovered mid-run',
	'**Do not park.**',
	PARK_ONLY_FOR,
	// The loop is where a reader following the run arrives, so the branch has to be stated there.
	'`epic:next` classifies the original child as resolving on its own',
	`**Remove \`${IN_PROGRESS_LABEL}\` from \`<M>\`.**`,
	'**Stash the work in progress.**',
	UNTRACKED_REQUIRED,
	'It is filed **first** because the next step has to name it',
]

const STOPPING_ENTRY_MARKERS: ReadonlyArray<string> = [
	'A prerequisite Issue discovered mid-run stops this command too',
	'without asking',
	'a batch is a different authorization',
	'Automatic filing is capped at 10 Issues per run',
	'**Create a new epic, with `--ordered`**',
	'**`--ordered` is required, not stylistic**',
	`**Remove \`${IN_PROGRESS_LABEL}\` from \`#N\`**`,
	'**Stash the work in progress**',
	UNTRACKED_REQUIRED,
	'**The Issue comment is what gets the stash popped**',
	'It goes first because the steps below name it.',
]

describe('prerequisite-issue definition', () => {
	it.each(AI_DOCS)('defines the rule in %s itself, not only in the skill', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('has a canonical section in the workflow prompt', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of CANONICAL_MARKERS) expect(content).toContain(marker)
	})

	it('names the command that records the dependency, in the canonical reference', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of TOOL_MARKERS) expect(content).toContain(marker)
	})

	it('pins a number on the automatic-filing ceiling', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of GUARD_MARKERS) expect(content).toContain(marker)
	})
})

describe('prerequisite-issue definition — the skills', () => {
	it('carries the unattended branch in the epicrun skill', () => {
		const content = read_unwrapped(EPICRUN_SKILL)

		for (const marker of EPICRUN_SKILL_MARKERS) expect(content).toContain(marker)
	})

	it.each(STOPPING_ENTRY_SKILLS)('carries the stopping branch in %s', (skill) => {
		const content = read_unwrapped(skill)

		for (const marker of STOPPING_ENTRY_MARKERS) expect(content).toContain(marker)
	})

	// A prerequisite read as a split goes down a procedure that stops even inside an `epicrun`,
	// which is the failure this whole rule exists to remove.
	it('separates a prerequisite from a split where the split is assessed', () => {
		const content = read_unwrapped(SPLIT_SKILL)

		expect(content).toContain('## A prerequisite is not a split')
		expect(content).toContain('it is still **one** deliverable that has another one in front of it')
	})

	// The paragraph was written for `fullrun` and copied into `halfrun`, where "approved … merging"
	// contradicts the same file's "Invoking `halfrun` is _not_ authorization to commit, push, or
	// merge" — a distributed document that authorizes a merge it forbids two paragraphs later.
	it('does not tell halfrun it was authorized to merge', () => {
		expect(read_unwrapped(HALFRUN_SKILL)).not.toContain(
			'Typing `halfrun` approved implementing and merging',
		)
	})

	it('names the label a park would apply, so the cost of parking is visible', () => {
		expect(read_repo_file(EPICRUN_SKILL)).toContain(NEEDS_DECISION_LABEL)
	})

	// The split procedure had told the reader to edit the epic body; a leftover instruction to do so
	// is the defect joshuafolkken/kit#890 removed the need for.
	it('routes the mid-run split through the command rather than a hand edit', () => {
		const content = read_unwrapped(EPICRUN_SKILL)

		expect(content).toContain('pnpm josh epic --add <E> <N...>')
		expect(content).toContain('rather than editing the epic body by hand')
	})
})
