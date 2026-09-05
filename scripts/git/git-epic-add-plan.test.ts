import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import {
	git_epic_add_plan,
	type AddPlan,
	type PlanInput,
	type PlanOutcome,
} from './git-epic-add-plan'
import { git_epic_parse } from './git-epic-parse'

const REPO = 'joshuafolkken/kit'
const EPIC_NUMBER = 893
const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const BLANK = ''
const INSERTED_CHAIN = '#890 -> #894 -> #891 -> #892'
const ROW_890 = '- [ ] #890'
const ROW_891 = '- [ ] #891'
const ROW_892 = '- [ ] #892'
const ORDERED_CHAIN = '#890 -> #891 -> #892'
const ALREADY_TRACKED = 'already tracked'

const ORDERED_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	ORDERED_CHAIN,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	ROW_891,
	ROW_892,
	BLANK,
].join('\n')

const UNORDERED_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	'None — the children are independent; any execution order works.',
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	ROW_891,
	BLANK,
].join('\n')

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

// The relations an epic created with `--ordered` actually carries for `#890 -> #891 -> #892`.
const ORDERED_CHILDREN = [child(890), child(891, [890]), child(892, [891])]
// The same epic on a `gh` too old to record any of them.
const UNRECORDED_CHILDREN = [child(890), child(891), child(892)]

function plan(overrides: Partial<PlanInput>): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: REPO,
		body: ORDERED_BODY,
		labels: ['epic'],
		children: [894],
		recorded: ORDERED_CHILDREN,
		...overrides,
	})
}

function plan_of(outcome: PlanOutcome): AddPlan {
	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.plan
}

function error_of(outcome: PlanOutcome): string {
	if ('plan' in outcome) throw new Error('expected a refusal')

	return outcome.error
}

describe('git_epic_add_plan.build_plan — appending', () => {
	it('tracks the new child', () => {
		const tracked = git_epic_parse.parse_task_list_issue_numbers(plan_of(plan({})).body)

		expect(tracked).toStrictEqual([890, 891, 892, 894])
	})

	it('extends the declared chain and records only the new link', () => {
		const appended = plan_of(plan({}))

		expect(appended.body).toContain('#890 -> #891 -> #892 -> #894')
		expect(appended.added).toStrictEqual([{ blocker: 892, blocked: 894 }])
		expect(appended.removed).toStrictEqual([])
	})

	it('keeps an unordered batch unordered', () => {
		const unordered = plan_of(plan({ body: UNORDERED_BODY, recorded: [child(890), child(891)] }))

		expect(git_epic_parse.has_unordered_declaration(unordered.body)).toBe(true)
		expect(unordered.added).toStrictEqual([])
	})
})

describe('git_epic_add_plan.build_plan — positioning', () => {
	it('re-points the blocker of the target so the chain is not broken', () => {
		const inserted = plan_of(plan({ position: { kind: 'before', target: 891 } }))

		expect(inserted.body).toContain(INSERTED_CHAIN)
		expect(inserted.added).toStrictEqual([
			{ blocker: 890, blocked: 894 },
			{ blocker: 894, blocked: 891 },
		])
		expect(inserted.removed).toStrictEqual([{ blocker: 890, blocked: 891 }])
	})

	it('inserts after the target when asked', () => {
		const inserted = plan_of(plan({ position: { kind: 'after', target: 890 } }))

		expect(inserted.body).toContain(INSERTED_CHAIN)
	})

	it('removes nothing when the target has no blocker yet', () => {
		const inserted = plan_of(plan({ position: { kind: 'before', target: 890 } }))

		expect(inserted.removed).toStrictEqual([])
		expect(inserted.body).toContain('#894 -> #890 -> #891 -> #892')
	})
})

describe('git_epic_add_plan.build_plan — what it refuses without writing', () => {
	it('refuses an issue that is not an epic', () => {
		expect(error_of(plan({ labels: [] }))).toContain('does not carry the `epic` label')
	})

	// joshuafolkken/kit#985: `into <target>` sends a run here with a target a person named, and a
	// refusal that only says "not an epic" leaves that run with nothing to do — the Issue it just
	// filed then belongs to no epic, which is the state `epic:next` never offers again. Both arms are
	// named because which one applies depends on what the target is.
	it('names both ways out of a target that is not an epic', () => {
		const error = error_of(plan({ labels: [] }))

		expect(error).toContain(`josh epic --promote ${String(EPIC_NUMBER)} <N...>`)
		expect(error).toContain('create a new epic over both')
	})

	it('refuses an epic with no task-list row', () => {
		const outcome = plan({ body: `${DEPENDENCIES_HEADING}\n\n#890 -> #891\n`, recorded: [] })

		expect(error_of(outcome)).toContain('tracks no child')
	})

	it('refuses a position target that is not a child of the epic', () => {
		const outcome = plan({ position: { kind: 'before', target: 777 } })

		expect(error_of(outcome)).toContain('#777 is not a child of this epic')
	})

	it('refuses when every issue given is already tracked', () => {
		expect(error_of(plan({ children: [890, 891] }))).toContain(ALREADY_TRACKED)
	})

	it('refuses when the epic records a relation its body never declares', () => {
		const outcome = plan({
			recorded: [child(890, [892]), child(891, [890]), child(892, [891])],
		})

		expect(error_of(outcome)).toContain('records relations its body does not declare')
	})

	it('refuses an epic whose dependencies section is prose', () => {
		const prose = `${DEPENDENCIES_HEADING}\n\nDo #890 first.\n\n${PROGRESS_HEADING}\n\n- [ ] #890\n`

		expect(error_of(plan({ body: prose }))).toContain(
			'no unambiguous machine-readable `Dependencies` declaration',
		)
	})
})

describe('git_epic_add_plan.build_plan — relations the body already declared', () => {
	it('records a declared link that was never applied, so the write repairs it', () => {
		const repaired = plan_of(plan({ recorded: UNRECORDED_CHILDREN }))

		expect(repaired.added).toStrictEqual([
			{ blocker: 890, blocked: 891 },
			{ blocker: 891, blocked: 892 },
			{ blocker: 892, blocked: 894 },
		])
	})

	it('never asks to drop a link that was never recorded', () => {
		const repaired = plan_of(
			plan({ position: { kind: 'before', target: 891 }, recorded: UNRECORDED_CHILDREN }),
		)

		expect(repaired.removed).toStrictEqual([])
	})
})

describe('git_epic_add_plan.build_plan — a child the declaration still names', () => {
	// The task list and the declaration can disagree; re-adding an issue the chain already names
	// would append it twice and make the epic cyclic, whose verdict is `error`.
	const LOST_ROW_BODY = [
		DEPENDENCIES_HEADING,
		BLANK,
		ORDERED_CHAIN,
		BLANK,
		PROGRESS_HEADING,
		BLANK,
		ROW_890,
		ROW_892,
		BLANK,
	].join('\n')

	it('refuses to add an issue the chain already names', () => {
		const outcome = plan({ body: LOST_ROW_BODY, children: [891], recorded: ORDERED_CHILDREN })

		expect(error_of(outcome)).toContain(ALREADY_TRACKED)
	})

	it('refuses to insert one before a sibling, rather than producing a cycle', () => {
		const outcome = plan({
			body: LOST_ROW_BODY,
			children: [891],
			position: { kind: 'before', target: 892 },
			recorded: ORDERED_CHILDREN,
		})

		expect(error_of(outcome)).toContain(ALREADY_TRACKED)
	})
})

describe('git_epic_add_plan.build_plan — a cross-repository epic', () => {
	it('refuses rather than planning against a partial graph', () => {
		const external = [
			DEPENDENCIES_HEADING,
			BLANK,
			'#890 -> #891',
			BLANK,
			PROGRESS_HEADING,
			BLANK,
			ROW_890,
			'- [ ] joshuafolkken/app-kit#12',
			BLANK,
		].join('\n')

		expect(error_of(plan({ body: external }))).toContain('tracks a child in another repository')
	})
})

// joshuafolkken/kit#949: an epic whose task list has a child no chain names. `--before` on that
// child was refused, which left a prerequisite discovered against it with nowhere to be recorded —
// and the refusal is the same one raised for a number that is not a child at all.
const MIXED_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	ORDERED_CHAIN,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	ROW_891,
	ROW_892,
	'- [ ] #895',
	BLANK,
].join('\n')

// #895 is tracked and carries no relation, which is what "no order constraint" looks like.
const MIXED_CHILDREN = [...ORDERED_CHILDREN, child(895)]

function mixed_plan(position: PlanInput['position']): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: REPO,
		body: MIXED_BODY,
		labels: ['epic'],
		children: [894],
		recorded: MIXED_CHILDREN,
		position,
	})
}

describe('git_epic_add_plan.build_plan — a child with no order yet', () => {
	it('declares a new chain rather than refusing', () => {
		const built = plan_of(mixed_plan({ kind: 'before', target: 895 }))

		expect(built.body).toContain('#894 -> #895')
		expect(built.added).toStrictEqual([{ blocker: 894, blocked: 895 }])
	})

	it('puts the target first for --after', () => {
		expect(plan_of(mixed_plan({ kind: 'after', target: 895 })).body).toContain('#895 -> #894')
	})

	// The chain that was already declared belongs to somebody else's ordering decision.
	it('leaves the existing declaration and its relations alone', () => {
		const built = plan_of(mixed_plan({ kind: 'before', target: 895 }))

		expect(built.body).toContain(ORDERED_CHAIN)
		expect(built.removed).toStrictEqual([])
	})

	// The body has to read back as what was written, or `epic:next` reports a declaration mismatch
	// against the relations the command just recorded.
	it('writes a declaration that parses back to both chains', () => {
		const built = plan_of(mixed_plan({ kind: 'before', target: 895 }))

		expect(git_epic_parse.parse_dependency_chains(built.body)).toStrictEqual([
			[890, 891, 892],
			[894, 895],
		])
		expect(git_epic_parse.parse_task_list_issue_numbers(built.body)).toStrictEqual([
			890, 891, 892, 895, 894,
		])
	})

	// Unchanged: a number the epic does not track still cannot position an insertion.
	it('still refuses a target that is not a child', () => {
		expect(error_of(mixed_plan({ kind: 'before', target: 999 }))).toContain(
			'is not a child of this epic',
		)
	})
})

// joshuafolkken/kit#1350: a record that cannot be written is refused before anything reaches GitHub,
// because `--decision-file` was given precisely because the record has to exist.
describe('git_epic_add_plan.build_plan — the decision record', () => {
	const REASON_LINE = '- 理由: 主題が同じ'
	const RECORD = ['### Where #894 goes', BLANK, REASON_LINE].join('\n')
	const CHAIN_LINE = '#890 -> #894'
	const CHAIN_RECORD = ['- 経緯: なし', CHAIN_LINE].join('\n')

	it('writes the record into the epic body it hands back', () => {
		const built = plan_of(plan({ decision: RECORD }))

		expect(built.body).toContain('## Decisions')
		expect(built.body).toContain(REASON_LINE)
	})

	it('refuses a record that says nothing, and hands back no body', () => {
		expect(error_of(plan({ decision: '  \n' }))).toContain('empty')
	})

	it('refuses a record carrying a bare dependency chain', () => {
		expect(error_of(plan({ decision: CHAIN_RECORD }))).toContain(CHAIN_LINE)
	})

	// The refusals above must not fire before the ones that were already there: an insertion into a
	// non-epic is wrong whatever the record says.
	it('reports a non-epic target rather than the record', () => {
		expect(error_of(plan({ labels: [], decision: '  ' }))).toContain('is not an epic')
	})

	it('leaves the plan exactly as it was when no record is given', () => {
		expect(plan_of(plan({})).body).toBe(plan_of(plan({ decision: undefined })).body)
	})
})
