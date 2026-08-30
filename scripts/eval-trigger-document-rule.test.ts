import { AI_DOCS, read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { eval_report } from '#scripts/eval/eval-report'
import { eval_trigger } from '#scripts/eval/eval-trigger'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#907: `josh eval` existed and nothing said when to run it, so a pull request that
// rewrote one rule and regressed another had no detection path. Three things can rot independently —
// a document can stop naming the command, the path set it prints can drift from the one the command
// uses, and a procedure a run follows can go back to typing its own gate without the measurement.

const COMMAND = 'pnpm josh eval:scope'
const SKILL_GATE = '.claude/skills/workflow-commands/eval-gate.md'
const PROMPT_GATE = 'prompts/collaboration-workflow/eval-gate.md'
const EVAL_DOC = 'docs/eval.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const EPICRUN_FILE = '.claude/skills/workflow-commands/epicrun.md'
const BASELINE_COMMAND = 'git stash push -u'

// Every file that tells a run whether to measure. A rule documented in one place while every
// procedure a run actually follows still went straight from the review to the commit would read as
// shipped and change nothing.
const FLOW_DOCUMENTS: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
	SKILL_GATE,
]

// Where the trigger set is written out for a reader, and therefore where it can go stale.
// Where the trigger set is written out for a reader. `CLAUDE.md` is deliberately absent: the
// resident text is the trigger plus a pointer, and the set lives at the pointer. Measured, not
// assumed — the resident step listed the whole set until `josh eval` showed the explicit-invocation
// scenario failing on the enlarged document and holding on the one before it
// (joshuafolkken/kit#907).
const SET_DOCUMENTS: ReadonlyArray<string> = [SKILL_GATE, PROMPT_GATE, EVAL_DOC, COMMAND_DOC]

describe('the trigger is routed to the command', () => {
	it.each([...AI_DOCS, ...FLOW_DOCUMENTS, EVAL_DOC, COMMAND_DOC])(
		'%s names the command',
		(document_path) => {
			expect(read_repo_file(document_path)).toContain(COMMAND)
		},
	)

	it.each([...AI_DOCS, SKILL_GATE, EVAL_DOC, COMMAND_DOC])(
		'%s says the trigger is not a judgement',
		(document_path) => {
			expect(read_unwrapped(document_path)).toContain('judgement')
		},
	)
})

// The set in the prose has to be the set the command uses. It is derived from what the eval sandbox
// copies, so a document naming a path no scenario reads would ask for real Claude sessions that
// measure nothing.
describe('the documented trigger set is the one the command uses', () => {
	it.each(SET_DOCUMENTS)('%s names every measured path', (document_path) => {
		const content = read_unwrapped(document_path)

		for (const glob of eval_trigger.MEASURED_GLOBS) expect(content).toContain(`\`${glob}\``)
	})
})

describe('the placement is stated where a run would otherwise fold it into the gate', () => {
	it.each([...AI_DOCS, SKILL_GATE, EVAL_DOC])(
		'%s keeps the measurement out of `josh gate`',
		(document_path) => {
			const content = read_unwrapped(document_path).toLowerCase()

			expect(content).toContain('never inside')
			expect(content).toContain('`pnpm josh gate`')
		},
	)

	// The Japanese canonical says the same thing in its own words; asserting the English marker there
	// would pin a translation nobody agreed to.
	it('the canonical reference keeps it out of the gate too', () => {
		expect(read_unwrapped(PROMPT_GATE)).toContain('`pnpm josh gate` の中には入れない')
	})

	it('the command reference points at where the answer is used', () => {
		expect(read_unwrapped(COMMAND_DOC)).toContain('When it runs')
	})
})

describe('what a verdict does is stated with the tokens the run prints', () => {
	const ALL_VERDICTS: ReadonlyArray<string> = [
		eval_report.VERDICT_BLOCKED,
		eval_report.VERDICT_HELD,
		eval_report.VERDICT_UNMEASURED,
	]

	it.each([SKILL_GATE, EVAL_DOC])('%s names every verdict', (document_path) => {
		const content = read_unwrapped(document_path)

		for (const verdict of ALL_VERDICTS) expect(content).toContain(`\`${verdict}\``)
	})

	// The resident text carries the two that decide behavior. `held` needs no instruction — it is
	// what "continue" already means — and residency is paid for in bytes the next rule then has to
	// take back out of existing prose.
	it.each(AI_DOCS)('%s names the two verdicts that change what a run does', (document_path) => {
		const content = read_unwrapped(document_path)

		expect(content).toContain(`\`${eval_report.VERDICT_BLOCKED}\``)
		expect(content).toContain(`\`${eval_report.VERDICT_UNMEASURED}\``)
	})

	// The two that must not be treated alike: one is a measured violation, the other is the shared
	// budget saying nothing.
	it.each([...AI_DOCS, SKILL_GATE, EVAL_DOC])(
		'%s says a blocked run stops the merge and an unmeasured one does not',
		(document_path) => {
			const content = read_unwrapped(document_path).toLowerCase()

			expect(content).toContain('stop')
			expect(content).toContain('not block')
		},
	)
})

// A red scenario may predate the change: the suite measures the whole distribution, not the diff. A
// rule that blocked on the verdict alone would freeze every distributed-document change behind a
// defect none of them introduced, so the baseline reading is part of the rule rather than advice.
describe('a blocked verdict is attributed before it blocks', () => {
	it.each([SKILL_GATE, EVAL_DOC])(
		'%s says to re-read the scenario against the pre-change documents',
		(document_path) => {
			const content = read_unwrapped(document_path)

			expect(content).toContain(BASELINE_COMMAND)
			expect(content).toContain('pnpm josh eval <name>')
		},
	)

	// The resident text keeps the instruction that changes behavior — attribute before blocking —
	// and sends the reader to the pointer for how.
	it.each(AI_DOCS)('%s says a blocked verdict is attributed before it blocks', (document_path) => {
		const content = read_unwrapped(document_path)

		expect(content).toContain('attribute it first')
		expect(content).toContain('eval-gate.md')
	})

	// joshuafolkken/kit#1071: one scenario is one real Claude session, so a single reading either side
	// is a sample. `no-implicit-workflow` failed 2 of 10 readings of an unchanged tree, which is enough
	// for a pair of single readings to manufacture `held → failed` — and it did, on
	// joshuafolkken/kit#1062. The confirmation is part of the rule for the same reason the baseline is.
	it.each([SKILL_GATE, EVAL_DOC])(
		'%s confirms a red on the same tree before the pair is formed',
		(document_path) => {
			expect(read_unwrapped(document_path).toLowerCase()).toContain('the same tree')
		},
	)

	// The canonical reference is Japanese and is held to its own words, as above.
	it('the canonical reference asks for the same-tree confirmation too', () => {
		expect(read_unwrapped(PROMPT_GATE)).toContain('同じ木で再現を確認する')
	})

	it.each([SKILL_GATE, EVAL_DOC])(
		'%s says a standing failure is filed rather than held against the change',
		(document_path) => {
			expect(read_unwrapped(document_path).toLowerCase()).toContain('standing failure')
		},
	)

	// The canonical reference is Japanese; pinning the English phrase there would pin a translation
	// nobody agreed to, so it is held to its own words.
	it('the canonical reference carries the same split', () => {
		const content = read_unwrapped(PROMPT_GATE)

		expect(content).toContain(BASELINE_COMMAND)
		expect(content).toContain('元から立っている失敗')
	})
})

// The addendum joshuafolkken/kit#907 answered. Recording only the decision would leave the next
// reader to re-derive it, and the reason is the half that answers the objection.
//
// Each document is pinned by its own words rather than one shared phrase: the canonical reference is
// Japanese, and a marker that forced an English sentence into it would pin a translation nobody
// agreed to.
const EPIC_DECISION_MARKERS: ReadonlyArray<[string, string]> = [
	[EPICRUN_FILE, 'does not run the suite again'],
	[SKILL_GATE, 'does not run it again'],
	[PROMPT_GATE, 'EPIC 完了時には回さない'],
	[EVAL_DOC, 'does not run it a second time'],
]

describe('the epic-completion decision is recorded with its reason', () => {
	it.each(EPIC_DECISION_MARKERS)('%s says the suite is not run again', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	it('the canonical reference answers the "no other instrument" objection', () => {
		const content = read_unwrapped(PROMPT_GATE)

		expect(content).toContain('joshuafolkken/kit#917')
		expect(content).toContain('joshuafolkken/kit#860')
	})
})
