import { describe, expect, it } from 'vitest'
import {
	BLANK,
	DEPENDENCIES_HEADING,
	EPIC_FIXTURE_REPO,
	git_epic_add_fixture,
	PROGRESS_HEADING,
} from './git-epic-add-fixture'
import { git_epic_add_plan, type PlanInput, type PlanOutcome } from './git-epic-add-plan'
import { git_epic_parse, UNORDERED_DEPENDENCIES } from './git-epic-parse'

// `--order-before` / `--order-after`: move the task-list row and write nothing else
// (joshuafolkken/kit#1738).
//
// `epic:next` offers children in task-list order, so "no dependency, but run this one first" could
// only be spelled `--before`, which records a `blocked-by`. The order then really did block: whatever
// stalled the first child withheld every child behind it. These tests pin the half that makes the
// option worth having — that the declaration and the relations come out untouched — because a
// regression there is invisible in the body diff the caller reads.

const { child, plan_of, error_of, rows, body_of, tracked_of, declared_of, links_of } =
	git_epic_add_fixture
const EPIC_NUMBER = 893
const ORDERED_CHAIN = '#890 -> #891 -> #892'
const FIRST_CHAIN = '#890 -> #891'
const FAN_IN_CHAIN = '#892 -> #891'

const ORDERED_BODY = body_of([ORDERED_CHAIN], [890, 891, 892])
const UNORDERED_BODY = body_of([UNORDERED_DEPENDENCIES], [890, 891])
const FAN_IN_BODY = body_of([FIRST_CHAIN, FAN_IN_CHAIN], [890, 891, 892])

const ORDERED_CHILDREN = [child(890), child(891, [890]), child(892, [891])]
const FAN_IN_CHILDREN = [child(890), child(891, [890, 892]), child(892)]

// A partly-ordered epic: `#890 -> #892` is declared, `#891` is free. The order-only warning must fire
// where a move contradicts this declaration through a child the move target never named, and stay
// silent where the unconstrained `#891` is reordered (joshuafolkken/kit#1753).
const PARTIAL_CHAIN = '#890 -> #892'
const PARTIAL_BODY = body_of([PARTIAL_CHAIN], [890, 891, 892])
const REORDERED_BODY = body_of([PARTIAL_CHAIN], [891, 890, 892])
const PARTIAL_CHILDREN = [child(890), child(891), child(892, [890])]

function plan(overrides: Partial<PlanInput>): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: EPIC_FIXTURE_REPO,
		body: ORDERED_BODY,
		labels: ['epic'],
		children: [892],
		recorded: ORDERED_CHILDREN,
		is_order_only: true,
		...overrides,
	})
}

function wrote_no_relation(outcome: PlanOutcome): boolean {
	const built = plan_of(outcome)

	return built.added.length + built.removed.length + built.replaced.length === 0
}

describe('git_epic_add_plan.build_plan — an order-only move of a tracked child', () => {
	const moved = plan({ position: { kind: 'before', target: 891 } })

	it('reports the child as moved rather than added', () => {
		expect(plan_of(moved).relocations).toStrictEqual([892])
		expect(plan_of(moved).additions).toStrictEqual([])
	})

	it('moves the task-list row to the position', () => {
		expect(tracked_of(moved)).toStrictEqual([890, 892, 891])
	})

	// The whole point of the option: the row is somewhere else and the declaration says exactly what it
	// said before. `--before` on this same input would have declared `#890 -> #892 -> #891`.
	it('leaves the declaration exactly as it stood', () => {
		expect(declared_of(moved)).toStrictEqual([ORDERED_CHAIN])
	})

	it('leaves the `## Dependencies` section byte-identical', () => {
		expect(plan_of(moved).body).toContain(`${DEPENDENCIES_HEADING}\n${BLANK}\n${ORDERED_CHAIN}`)
	})

	it('records and drops no relation at all', () => {
		expect(links_of(plan_of(moved).added)).toStrictEqual([])
		expect(links_of(plan_of(moved).removed)).toStrictEqual([])
		expect(links_of(plan_of(moved).replaced)).toStrictEqual([])
	})

	it('leaves a body `epic:check` can still read', () => {
		expect(git_epic_parse.has_machine_readable_declaration(plan_of(moved).body)).toBe(true)
	})

	// `#891` blocks `#892` in `#890 -> #891 -> #892`, and `epic:next` filters by `blocked_by` before it
	// applies task-list order — so this row cannot take effect until the declaration changes, and the
	// placement line read alone would say otherwise.
	it('names the child the declaration still holds', () => {
		expect(plan_of(moved).contradicted).toStrictEqual([892])
	})
})

describe('git_epic_add_plan.build_plan — an order-only move the declaration does not contradict', () => {
	// A child no chain names, reordered inside a partly-ordered epic: seating `#891`'s row anywhere
	// leaves the declared `#890 -> #892` intact, so no warning fires — the legitimate reorder the
	// exhaustive check must not block (joshuafolkken/kit#1753).
	it('says nothing about reordering a child the declaration never constrains', () => {
		const free = plan({
			body: PARTIAL_BODY,
			children: [891],
			recorded: PARTIAL_CHILDREN,
			position: { kind: 'after', target: 892 },
		})

		expect(tracked_of(free)).toStrictEqual([890, 892, 891])
		expect(plan_of(free).contradicted).toStrictEqual([])
	})

	it('says nothing where no chain names both issues', () => {
		const unordered = plan({
			body: UNORDERED_BODY,
			children: [891],
			recorded: [child(890), child(891)],
			position: { kind: 'before', target: 890 },
		})

		expect(plan_of(unordered).contradicted).toStrictEqual([])
	})

	// An ordinary insertion rewrites the declaration to match the row it placed, so there is nothing
	// left for the row to contradict — the field is empty by construction rather than by a check.
	it('says nothing for an insertion that writes its own declaration', () => {
		const declared = plan({ is_order_only: false, position: { kind: 'before', target: 891 } })

		expect(plan_of(declared).contradicted).toStrictEqual([])
	})
})

describe('git_epic_add_plan.build_plan — an order-only move that contradicts a child other than the target', () => {
	// The reproduction from joshuafolkken/kit#1753: `#890 -> #892` is declared, the rows are
	// `[891, 890, 892]`, and `#892` is moved before `#891`. The result seats `#892` ahead of `#890`,
	// contradicting the declaration — but the target `#891` is named by no chain, so a check that
	// compared only the target stayed silent.
	const moved = plan({
		body: REORDERED_BODY,
		children: [892],
		recorded: PARTIAL_CHILDREN,
		position: { kind: 'before', target: 891 },
	})

	it('moves the row ahead of the target', () => {
		expect(tracked_of(moved)).toStrictEqual([892, 891, 890])
	})

	it('names the moved child even though the contradiction is not with the target', () => {
		expect(plan_of(moved).contradicted).toStrictEqual([892])
	})

	// The fully-ordered mirror: `#890 -> #891 -> #892`, move `#890` before `#892`. The row lands after
	// `#891`, so the contradiction is with the third child `#891`, not the target `#892` — which the
	// move agrees with. A target-only check read this as clean.
	it('names a child seated behind an issue it is declared to block', () => {
		const behind = plan({ children: [890], position: { kind: 'before', target: 892 } })

		expect(tracked_of(behind)).toStrictEqual([891, 890, 892])
		expect(plan_of(behind).contradicted).toStrictEqual([890])
	})
})

describe('git_epic_add_plan.build_plan — an order-only move after a target', () => {
	const moved = plan({ children: [890], position: { kind: 'after', target: 892 } })

	it('moves the row to the far side of the target', () => {
		expect(tracked_of(moved)).toStrictEqual([891, 892, 890])
	})

	it('still declares the order it started with', () => {
		expect(declared_of(moved)).toStrictEqual([ORDERED_CHAIN])
	})

	// `#890` is declared to run before `#892`, and this puts its row behind `#892`'s.
	it('names the child whose declared order the move contradicts', () => {
		expect(plan_of(moved).contradicted).toStrictEqual([890])
	})
})

// An epic mixing ordered and unordered children is the normal state, and an unordered one is where
// this option is reached for most often: every child is runnable, and the only question is which one
// `epic:next` offers first.
describe('git_epic_add_plan.build_plan — an order-only placement of a new child', () => {
	const placed = plan({
		body: UNORDERED_BODY,
		children: [894],
		recorded: [child(890), child(891)],
		position: { kind: 'before', target: 890 },
	})

	it('adds the row at the position', () => {
		expect(plan_of(placed).additions).toStrictEqual([894])
		expect(tracked_of(placed)).toStrictEqual([894, 890, 891])
	})

	// `--before 890` here would have replaced the unordered literal with `#894 -> #890`, and every
	// child behind `#894` would have waited on it.
	it('leaves the epic declaring no order', () => {
		expect(plan_of(placed).body).toContain(UNORDERED_DEPENDENCIES)
		expect(wrote_no_relation(placed)).toBe(true)
	})
})

// The declared-but-unrecorded repair an ordinary insertion makes in passing. It is withheld here: the
// caller asked for no `blocked-by`, and a repair would put one back under a flag that promises none.
describe('git_epic_add_plan.build_plan — an epic whose declaration GitHub never recorded', () => {
	const moved = plan({
		position: { kind: 'before', target: 891 },
		recorded: [child(890), child(891), child(892)],
	})

	it('records nothing, even though the declaration names links GitHub lacks', () => {
		expect(wrote_no_relation(moved)).toBe(true)
	})
})

describe('git_epic_add_plan.build_plan — what an order-only move refuses', () => {
	it('refuses a target the epic does not track, writing nothing', () => {
		const error = error_of(plan({ position: { kind: 'after', target: 999 } }))

		expect(error).toContain('is not a child of this epic')
	})

	it('refuses a child positioned against itself', () => {
		const error = error_of(plan({ position: { kind: 'after', target: 892 } }))

		expect(error).toContain('cannot position an insertion of itself')
	})

	// The hub ambiguity is a refusal about where a *dependency* would attach, and this move attaches
	// none — so the input `--before` is refused for is allowed here, and the declaration still comes out
	// unchanged.
	it('allows a position two chains name, since no link is being placed', () => {
		const moved = plan({
			body: FAN_IN_BODY,
			recorded: FAN_IN_CHILDREN,
			position: { kind: 'before', target: 891 },
		})

		expect(tracked_of(moved)).toStrictEqual([890, 892, 891])
		expect(declared_of(moved)).toStrictEqual([FIRST_CHAIN, FAN_IN_CHAIN])
	})
})

describe('git_epic_add_plan.build_plan — an order-only move leaves the rest of the body alone', () => {
	it('moves the real row and leaves a fenced example alone', () => {
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
		const moved = plan({ body: fenced, position: { kind: 'before', target: 891 } })

		expect(tracked_of(moved)).toStrictEqual([890, 892, 891])
		expect(plan_of(moved).body).toContain('```md\n- [ ] #892\n```')
	})
})
