import { describe, expect, it } from 'vitest'
import { EPIC_FIXTURE_REPO, git_epic_add_fixture } from './git-epic-add-fixture'
import { git_epic_add_plan, type PlanInput, type PlanOutcome } from './git-epic-add-plan'
import { git_epic_chains } from './git-epic-chains'
import { git_epic_parse, UNORDERED_DEPENDENCIES } from './git-epic-parse'

// Declaring an order between two children an epic **already tracks** (joshuafolkken/kit#1701).
//
// `--add` used to refuse the whole invocation as "nothing to add", and no other verb could write an
// order — so a prerequisite discovered between two tracked children had nowhere to go, and the only
// remaining route was the hand edit this command exists to prevent. A position now reads as a move:
// the child is spliced out of every chain that named it and re-inserted through the ordinary
// insertion path, so `--before` still re-points, `--after` still branches, and the vacated chain
// still closes around it — by construction rather than by a second code path.

const { child, plan_of } = git_epic_add_fixture
const EPIC_NUMBER = 893
const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const BLANK = ''
const ORDERED_CHAIN = '#890 -> #891 -> #892'
const FIRST_CHAIN = '#890 -> #891'
const AMBIGUOUS = 'appears in more than one declared chain'

function rows(...numbers: ReadonlyArray<number>): Array<string> {
	return numbers.map((issue_number) => `- [ ] #${String(issue_number)}`)
}

function body_of(declaration: ReadonlyArray<string>, tracked: ReadonlyArray<number>): string {
	return [
		DEPENDENCIES_HEADING,
		BLANK,
		...declaration,
		BLANK,
		PROGRESS_HEADING,
		BLANK,
		...rows(...tracked),
		BLANK,
	].join('\n')
}

const ORDERED_BODY = body_of([ORDERED_CHAIN], [890, 891, 892])
const UNORDERED_BODY = body_of([UNORDERED_DEPENDENCIES], [890, 891])
const FORKED_BODY = body_of([FIRST_CHAIN, '#895 -> #891'], [890, 891, 892, 895])

const FAN_IN_BODY = body_of([FIRST_CHAIN, '#892 -> #891'], [890, 891, 892])

const ORDERED_CHILDREN = [child(890), child(891, [890]), child(892, [891])]
const FORKED_CHILDREN = [child(890), child(891, [890, 895]), child(892), child(895)]
const FAN_IN_CHILDREN = [child(890), child(891, [890, 892]), child(892)]

function plan(overrides: Partial<PlanInput>): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: EPIC_FIXTURE_REPO,
		body: ORDERED_BODY,
		labels: ['epic'],
		children: [892],
		recorded: ORDERED_CHILDREN,
		...overrides,
	})
}

function error_of(outcome: PlanOutcome): string {
	if ('plan' in outcome) throw new Error('expected a refusal')

	return outcome.error
}

function tracked_of(outcome: PlanOutcome): Array<number> {
	return git_epic_parse.parse_task_list_issue_numbers(plan_of(outcome).body)
}

function declared_of(outcome: PlanOutcome): Array<string> {
	return git_epic_chains.render_chains(
		git_epic_parse.parse_dependency_chains(plan_of(outcome).body),
	)
}

function links_of(links: ReadonlyArray<{ blocker: number; blocked: number }>): Array<string> {
	return links.map((link) => `${String(link.blocker)}->${String(link.blocked)}`)
}

describe('git_epic_add_plan.build_plan — a tracked child given a position', () => {
	const moved = plan({ position: { kind: 'before', target: 891 } })

	it('reports the child as moved rather than added', () => {
		expect(plan_of(moved).relocations).toStrictEqual([892])
		expect(plan_of(moved).additions).toStrictEqual([])
	})

	it('moves the task-list row to the position', () => {
		expect(tracked_of(moved)).toStrictEqual([890, 892, 891])
	})

	it('declares the new chain, closing the one the child left', () => {
		expect(declared_of(moved)).toStrictEqual(['#890 -> #892 -> #891'])
	})

	it('records the new relations and drops the superseded ones', () => {
		expect(links_of(plan_of(moved).added)).toStrictEqual(['890->892', '892->891'])
		expect(links_of(plan_of(moved).removed)).toStrictEqual(['890->891', '891->892'])
	})
})

describe('git_epic_add_plan.build_plan — an epic that declared no order yet', () => {
	const first = plan({
		body: UNORDERED_BODY,
		children: [891],
		recorded: [child(890), child(891)],
		position: { kind: 'after', target: 890 },
	})

	// The unordered literal and a chain are the two machine-readable forms, and `epic:check` requires
	// exactly one of them — so declaring a first order has to replace the sentence, not sit beside it.
	it('replaces the unordered literal with the chain', () => {
		expect(declared_of(first)).toStrictEqual([FIRST_CHAIN])
		expect(plan_of(first).body).not.toContain(UNORDERED_DEPENDENCIES)
	})

	it('leaves a body `epic:check` can still read', () => {
		expect(git_epic_parse.has_machine_readable_declaration(plan_of(first).body)).toBe(true)
	})

	it('records the relation the position asked for', () => {
		expect(links_of(plan_of(first).added)).toStrictEqual(['890->891'])
	})
})

describe('git_epic_add_plan.build_plan — a move and an addition in one call', () => {
	const both = plan({
		children: [894, 892],
		position: { kind: 'before', target: 891 },
	})

	it('separates the row it appends from the row it moves', () => {
		expect(plan_of(both).additions).toStrictEqual([894])
		expect(plan_of(both).relocations).toStrictEqual([892])
	})

	// Both rows land at the position, in the order the caller named them — the added one no longer
	// stays at the end of the list while the declaration puts it in the middle
	// (joshuafolkken/kit#1704, the reconciliation joshuafolkken/kit#1701 pinned as a known
	// disagreement).
	it('places both at the position, in the order given', () => {
		expect(tracked_of(both)).toStrictEqual([890, 894, 892, 891])
	})

	it('declares them in the order they were given', () => {
		expect(declared_of(both)).toStrictEqual(['#890 -> #894 -> #892 -> #891'])
	})
})

// joshuafolkken/kit#1704: a positioned addition gained its task-list row at the end of the list
// while the declaration named the position, so the order the epic declares and the order `epic:next`
// presents disagreed. The row goes to the position too, and the round trip now checks it.
describe('git_epic_add_plan.build_plan — a positioned addition', () => {
	const before = plan({ children: [894], position: { kind: 'before', target: 891 } })
	const after = plan({ children: [894], position: { kind: 'after', target: 890 } })

	it('puts the added row directly before the target', () => {
		expect(tracked_of(before)).toStrictEqual([890, 894, 891, 892])
	})

	it('puts the added row directly after the target', () => {
		expect(tracked_of(after)).toStrictEqual([890, 894, 891, 892])
	})

	it('lists the children in the order it declares them', () => {
		expect(declared_of(before)).toStrictEqual(['#890 -> #894 -> #891 -> #892'])
	})

	it('still reports it as an addition rather than a move', () => {
		expect(plan_of(before).additions).toStrictEqual([894])
		expect(plan_of(before).relocations).toStrictEqual([])
	})
})

describe('git_epic_add_plan.build_plan — what a move does not change', () => {
	it('still refuses a tracked child given no position', () => {
		expect(error_of(plan({}))).toContain('already tracked')
	})

	it('names the flags that would make it a move', () => {
		expect(error_of(plan({}))).toContain('--before')
	})

	// A position that names one of the issues being placed is neither an addition nor a move, and
	// "nothing to add" would describe the wrong thing.
	it('refuses a child positioned against itself', () => {
		const error = error_of(plan({ position: { kind: 'after', target: 892 } }))

		expect(error).toContain('cannot position an insertion of itself')
	})

	it('still refuses a position naming an issue the epic does not track', () => {
		const error = error_of(plan({ position: { kind: 'after', target: 999 } }))

		expect(error).toContain('is not a child of this epic')
	})

	it('leaves an untracked child an ordinary addition', () => {
		const added = plan({ children: [894] })

		expect(plan_of(added).additions).toStrictEqual([894])
		expect(plan_of(added).relocations).toStrictEqual([])
		expect(tracked_of(added)).toStrictEqual([890, 891, 892, 894])
	})
})

describe('git_epic_add_plan.build_plan — a position that identifies no one place', () => {
	// The hub refusal from joshuafolkken/kit#1080: `#891` sits in two chains and neither of them can
	// be extended, so "before #891" does not identify one place. A move must not slip past it.
	it('still refuses a position on a target two chains name', () => {
		const error = error_of(
			plan({
				body: FORKED_BODY,
				recorded: FORKED_CHILDREN,
				children: [892],
				position: { kind: 'before', target: 891 },
			}),
		)

		expect(error).toContain(AMBIGUOUS)
	})

	// The counter-case, and the reorder joshuafolkken/kit#1701 exists for: `--after` cannot inherit an
	// unasked predecessor, so flipping `#892` from in front of `#891` to behind it is allowed even
	// though `#891` is named by two chains. Refusing it would refuse the Issue's headline case.
	it('allows an after-flip on the same fan-in', () => {
		const flipped = plan({
			body: FAN_IN_BODY,
			recorded: FAN_IN_CHILDREN,
			children: [892],
			position: { kind: 'after', target: 891 },
		})

		expect(declared_of(flipped)).toStrictEqual([ORDERED_CHAIN])
		expect(links_of(plan_of(flipped).added)).toStrictEqual(['891->892'])
		expect(links_of(plan_of(flipped).removed)).toStrictEqual(['892->891'])
	})

	// The removal a move starts with can **collapse** that ambiguity instead of resolving it: taking
	// `#892` out of `#892 -> #891` leaves `#890 -> #891` as the only chain naming `#891`, and splicing
	// there would record `#890 -> #892` — an order nobody asked for — while dropping `#890 -> #891`.
	// The refusal is decided on the declaration as it stands, so it fires here too.
	it('refuses a move whose removal would collapse the ambiguity', () => {
		const error = error_of(
			plan({
				body: FAN_IN_BODY,
				recorded: FAN_IN_CHILDREN,
				children: [892],
				position: { kind: 'before', target: 891 },
			}),
		)

		expect(error).toContain(AMBIGUOUS)
	})
})

describe('git_epic_add_plan.build_plan — a task-list row inside a fenced block', () => {
	// `- [ ] #892` in an example block is prose, and moving it would rewrite someone's example while
	// leaving the real row where it was.
	const fenced = [
		DEPENDENCIES_HEADING,
		BLANK,
		ORDERED_CHAIN,
		BLANK,
		'```md',
		'- [ ] #892',
		'```',
		BLANK,
		PROGRESS_HEADING,
		BLANK,
		...rows(890, 891, 892),
		BLANK,
	].join('\n')

	it('moves the real row and leaves the example alone', () => {
		const moved = plan({ body: fenced, position: { kind: 'before', target: 891 } })

		expect(tracked_of(moved)).toStrictEqual([890, 892, 891])
		expect(plan_of(moved).body).toContain('```md\n- [ ] #892\n```')
	})
})

// `replaced` against `removed` (joshuafolkken/kit#1711). `removed` is the work list handed to `gh`, so
// it is filtered down to relations that exist to be removed; `replaced` is what the declaration
// dropped, filtered by nothing. Reporting from the work list is how a declared-but-unrecorded order
// could be re-pointed without a word.
describe('git_epic_add_plan.build_plan — the relations a position replaces', () => {
	it('names a dropped link the epic never recorded natively', () => {
		const unrecorded = plan({
			position: { kind: 'before', target: 891 },
			recorded: [child(890), child(891), child(892)],
		})

		expect(links_of(plan_of(unrecorded).replaced)).toStrictEqual(['890->891', '891->892'])
		expect(plan_of(unrecorded).removed).toStrictEqual([])
	})

	it('names nothing for an addition that declares no order', () => {
		const appended = plan({
			body: UNORDERED_BODY,
			children: [894],
			recorded: [child(890), child(891)],
		})

		expect(plan_of(appended).replaced).toStrictEqual([])
	})
})
