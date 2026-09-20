import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { git_epic_reconcile, type ReconcilePlan } from './git-epic-reconcile'

// joshuafolkken/kit#2235: `--reconcile` brings an epic's `## Dependencies` declaration and its
// recorded `blocked-by` relations back into agreement. The four branches — a relation recorded but
// never declared, an order declared but never recorded, the two already agreeing, and a circular
// union — each have their own output, and none of them writes a `## Decisions` record.

const REPO = 'joshuafolkken/kit'

function child(number: number, blockers: ReadonlyArray<number>): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blockers.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

function body_with(dependencies: string): string {
	return ['## Progress', '- [ ] #1', '- [ ] #2', '', '## Dependencies', dependencies].join('\n')
}

const UNORDERED = 'None — the children are independent; any execution order works.'
const CHAIN = '#1 -> #2'
const EXPECTED_RECONCILIATION = 'expected a reconciliation'

function plan_for(dependencies: string, recorded: ReadonlyArray<EpicChild>): ReconcilePlan {
	return git_epic_reconcile.build_reconcile_plan({
		body: body_with(dependencies),
		recorded,
		repo: REPO,
	})
}

describe('a relation recorded but never declared is written into the declaration', () => {
	const plan = plan_for(UNORDERED, [child(1, []), child(2, [1])])

	it('reports a reconciliation that declares the recorded order', () => {
		expect(plan.kind).toBe('reconciled')
		if (plan.kind !== 'reconciled') return
		expect(plan.reconciliation.declare).toEqual([{ blocker: 1, blocked: 2 }])
		expect(plan.reconciliation.record).toEqual([])
	})

	it('rewrites the body to carry the chain and drop the unordered sentence', () => {
		if (plan.kind !== 'reconciled') throw new Error(EXPECTED_RECONCILIATION)
		expect(plan.reconciliation.body).toContain(CHAIN)
		expect(plan.reconciliation.body).not.toContain(UNORDERED)
	})
})

describe('an order declared but never recorded is aligned by recording the relation', () => {
	const plan = plan_for(CHAIN, [child(1, []), child(2, [])])

	it('records the declared order and leaves the body unchanged', () => {
		expect(plan.kind).toBe('reconciled')
		if (plan.kind !== 'reconciled') return
		expect(plan.reconciliation.record).toEqual([{ blocker: 1, blocked: 2 }])
		expect(plan.reconciliation.declare).toEqual([])
		expect(plan.reconciliation.body).toBeUndefined()
	})
})

describe('a declaration that already matches the relations reconciles to nothing', () => {
	it('reports nothing to reconcile', () => {
		expect(plan_for(CHAIN, [child(1, []), child(2, [1])]).kind).toBe('nothing')
	})
})

describe('a circular union of declared and recorded orders is refused', () => {
	const plan = plan_for(UNORDERED, [child(1, [2]), child(2, [1])])

	it('reports a cycle and writes nothing', () => {
		expect(plan.kind).toBe('cycle')
		if (plan.kind !== 'cycle') return
		expect(plan.message).toContain('Circular dependency')
	})
})

describe('reconciliation records no decision', () => {
	it('adds no `## Decisions` section when it rewrites the body', () => {
		const plan = plan_for(UNORDERED, [child(1, []), child(2, [1])])
		if (plan.kind !== 'reconciled') throw new Error(EXPECTED_RECONCILIATION)
		expect(plan.reconciliation.body).not.toContain('## Decisions')
	})
})
