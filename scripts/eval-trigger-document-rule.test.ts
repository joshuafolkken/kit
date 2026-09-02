import { AI_DOCS, read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { eval_report } from '#scripts/eval/eval-report'
import { eval_switch } from '#scripts/eval/eval-switch'
import { eval_trigger } from '#scripts/eval/eval-trigger'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#907: `josh eval` existed and nothing said when to run it, so a pull request that
// rewrote one rule and regressed another had no detection path. Three things can rot independently —
// a document can stop naming the command, the path set it prints can drift from the one the command
// uses, and a procedure a run follows can go back to typing its own gate without the measurement.
//
// joshuafolkken/kit#1177: the eval-gate body is single-sourced into the skill and the canonical topic
// file is now a pointer to it (the joshuafolkken/kit#1174 pattern). The canonical was formerly a
// Japanese full copy pinned section by section here; those assertions are replaced by the pointer
// suite at the bottom, and the "#917 / #860 no-other-instrument" citations moved to the skill with
// the body.

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
// `CLAUDE.md` is deliberately absent: the resident text is the trigger plus a pointer, and the set
// lives at the pointer. `PROMPT_GATE` is absent too since joshuafolkken/kit#1177 — it is a pointer,
// not a place the set is written out. Measured, not assumed — the resident step listed the whole set
// until `josh eval` showed the explicit-invocation scenario failing on the enlarged document and
// holding on the one before it (joshuafolkken/kit#907).
const SET_DOCUMENTS: ReadonlyArray<string> = [SKILL_GATE, EVAL_DOC, COMMAND_DOC]

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

// joshuafolkken/kit#1235: the measurement became opt-in, and a switch nobody documented is a hole
// rather than a setting — the trigger set below would then describe a decision the command no longer
// makes, and a reader chasing an unexpected `skip` would look for the defect in the paths.
describe('the opt-in switch is documented wherever the trigger is', () => {
	const SWITCH_ON = `${eval_switch.SWITCH_ENV_KEY}=on`

	it.each([SKILL_GATE, EVAL_DOC, COMMAND_DOC])('%s names the way back on', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(SWITCH_ON)
	})

	// The default is the half a reader gets wrong on their own: an undocumented unset-means-off reads
	// as a broken trigger, and an undocumented opt-in reads as a gate that was deleted.
	it.each([SKILL_GATE, EVAL_DOC, COMMAND_DOC])('%s says it is off by default', (document_path) => {
		expect(read_unwrapped(document_path).toLowerCase()).toContain('opt-in')
	})

	// The resident step is the one text a turn with no skill loaded reads, and it used to say the
	// trigger was decided from the changed paths — which the switch makes untrue. It carries the two
	// facts that change what a run does: the answer is the command's, and a `skip` it hands back may
	// mean nothing was measured at all.
	it.each(AI_DOCS)('%s says the measurement is opt-in', (document_path) => {
		const content = read_unwrapped(document_path)

		expect(content).toContain(eval_switch.SWITCH_ENV_KEY)
		expect(content.toLowerCase()).toContain('opt-in')
	})

	// The suite is still reachable by hand, which is what keeps a `blocked` verdict's baseline and
	// confirmation readings — and any diagnosis of the scenarios themselves — possible at all.
	it.each([SKILL_GATE, EVAL_DOC, COMMAND_DOC])(
		'%s says a person can still run the suite',
		(document_path) => {
			expect(read_unwrapped(document_path).toLowerCase()).toContain('still runs')
		},
	)
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

	it('the command reference points at where the answer is used', () => {
		expect(read_unwrapped(COMMAND_DOC)).toContain('When it runs')
	})
})

// joshuafolkken/kit#1152: the suite now starts when `/code-review` does, because neither writes to
// the working tree. That is only sound while the staleness check travels with it — a document that
// described the overlap without the re-check would ship a rule for reporting a verdict about a tree
// the review had already changed.
describe('the concurrent placement carries its staleness check', () => {
	const SINCE_EVAL_COMMAND = 'pnpm josh eval:scope --since-eval'

	it.each([SKILL_GATE, EVAL_DOC, COMMAND_DOC])('%s names the re-check command', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(SINCE_EVAL_COMMAND)
	})

	it.each([SKILL_GATE, EVAL_DOC])('%s says a stale result is never reported', (document_path) => {
		expect(read_unwrapped(document_path).toLowerCase()).toContain('stale result is never reported')
	})

	// The overlap is sound because of a property of the two commands, not because it is faster. A
	// document that dropped the reason would leave the next reader unable to tell whether a third
	// step could join them.
	it.each([SKILL_GATE, EVAL_DOC])('%s says why the two may overlap', (document_path) => {
		expect(read_unwrapped(document_path).toLowerCase()).toContain('neither writes')
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

	it.each([SKILL_GATE, EVAL_DOC])(
		'%s says a standing failure is filed rather than held against the change',
		(document_path) => {
			expect(read_unwrapped(document_path).toLowerCase()).toContain('standing failure')
		},
	)
})

// The addendum joshuafolkken/kit#907 answered. Recording only the decision would leave the next
// reader to re-derive it, and the reason is the half that answers the objection.
const EPIC_DECISION_MARKERS: ReadonlyArray<[string, string]> = [
	[EPICRUN_FILE, 'does not run the suite again'],
	[SKILL_GATE, 'does not run it again'],
	[EVAL_DOC, 'does not run it a second time'],
]

describe('the epic-completion decision is recorded with its reason', () => {
	it.each(EPIC_DECISION_MARKERS)('%s says the suite is not run again', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	// joshuafolkken/kit#1177 folded the "#917 / #860 no-other-instrument" reasoning into the skill when
	// the body was single-sourced, so the single source now carries the citations the canonical used
	// to hold.
	it('the skill answers the "no other instrument" objection', () => {
		const content = read_unwrapped(SKILL_GATE)

		expect(content).toContain('joshuafolkken/kit#917')
		expect(content).toContain('joshuafolkken/kit#860')
	})
})

// joshuafolkken/kit#1177: the canonical topic file is a pointer to the skill single source, not a
// second copy. The pointer test names the source; the body test proves the Japanese full copy that
// used to live here — pinned section by section above until this rollout — has not crept back.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const POINTER_MARKERS: ReadonlyArray<string> = [SKILL_GATE, 'クローン禁止・単一ソース化']
	const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
		'同じ木で再現を確認する',
		'元から立っている失敗',
	]

	it('names the skill as the single source', () => {
		const content = read_unwrapped(PROMPT_GATE)

		for (const marker of POINTER_MARKERS) expect(content).toContain(marker)
	})

	it('does not duplicate the rule body', () => {
		const content = read_unwrapped(PROMPT_GATE)

		for (const marker of REMOVED_BODY_MARKERS) expect(content).not.toContain(marker)
	})

	// A pointer file only helps while the documents that send a reader to the procedure name the
	// source rather than it. Both of these named the topic file until this rollout moved the body.
	it.each([...AI_DOCS, EVAL_DOC])('%s names the source', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(SKILL_GATE)
	})

	// Only `docs/eval.md` is held to the stronger form. It sent the reader to the topic file *for the
	// reasoning*, which is the dangling pointer this rollout created; `CLAUDE.md` may still cite a topic file that has
	// become a pointer, as it does for the joshuafolkken/kit#1174 pilot. Whether that citation
	// stays is the rollout's question, not this one's.
	it('does not send the reader to the pointer for the reasoning', () => {
		expect(read_unwrapped(EVAL_DOC)).not.toContain(PROMPT_GATE)
	})
})
