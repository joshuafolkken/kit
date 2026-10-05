import { describe, expect, it } from 'vitest'
import {
	BLANK,
	DEPENDENCIES_HEADING,
	epic_add_fixture,
	EPIC_FIXTURE_REPO,
	PROGRESS_HEADING,
} from './epic-add-fixture'
import { epic_add_plan, type PlanInput, type PlanOutcome } from './epic-add-plan'
import type { EpicChild } from './epic-graph'
import { epic_remove_plan } from './epic-remove-plan'

// joshuafolkken/kit#3161: an epic tracking one child in another repository refused every `--add`,
// unordered ones included, on the strength of a closed issue's scope. The declaration names bare
// numbers only, so no edit here can touch an order that crosses a repository; these pin that the
// edits now go through and leave the cross-repository row and relation alone.

const { child, plan_of, rows, tracked_of, declared_of, links_of } = epic_add_fixture
const EPIC_NUMBER = 893
const OTHER_REPO = 'joshuafolkken/app-kit'
const EXTERNAL_NUMBER = 12
const EXTERNAL_ROW = `- [ ] ${OTHER_REPO}#${String(EXTERNAL_NUMBER)}`
const CHAIN = '#890 -> #891'
const RECORD = 'Placed beside the cross-repository child because both touch the epic tooling.'

const BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	CHAIN,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	...rows(890, 891),
	EXTERNAL_ROW,
	BLANK,
].join('\n')

// The external child waits on `#891` through a native relation the body cannot declare.
const EXTERNAL_CHILD: EpicChild = {
	number: EXTERNAL_NUMBER,
	repo: OTHER_REPO,
	state: 'OPEN',
	labels: [],
	blocked_by: [{ repo: EPIC_FIXTURE_REPO, number: 891 }],
}

const RECORDED = [child(890), child(891, [890]), EXTERNAL_CHILD]

function plan(overrides: Partial<PlanInput>): PlanOutcome {
	return epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: EPIC_FIXTURE_REPO,
		body: BODY,
		labels: ['epic'],
		children: [894],
		recorded: RECORDED,
		...overrides,
	})
}

describe('epic_add_plan.build_plan — an epic tracking a cross-repository child', () => {
	it('adds an unordered child, keeps the external row and records the decision', () => {
		const outcome = plan({ decision: RECORD })
		const built = plan_of(outcome)

		expect(tracked_of(outcome)).toEqual([890, 891, 894])
		expect(built.body).toContain(EXTERNAL_ROW)
		expect(built.body).toContain(RECORD)
		expect(declared_of(outcome)).toEqual([CHAIN])
		expect(links_of(built.added)).toEqual([])
		expect(links_of(built.removed)).toEqual([])
	})

	it('moves a row with --order-after and writes no dependency', () => {
		const outcome = plan({
			children: [890],
			position: { kind: 'after', target: 891 },
			is_order_only: true,
		})

		expect(tracked_of(outcome)).toEqual([891, 890])
		expect(plan_of(outcome).body).toContain(EXTERNAL_ROW)
		expect(declared_of(outcome)).toEqual([CHAIN])
	})

	it('declares a same-repository order with --after without touching the external row', () => {
		const outcome = plan({ position: { kind: 'after', target: 891 } })

		expect(declared_of(outcome)).toEqual(['#890 -> #891 -> #894'])
		expect(links_of(plan_of(outcome).added)).toEqual(['891->894'])
		expect(plan_of(outcome).body).toContain(EXTERNAL_ROW)
	})
})

describe('epic_remove_plan.build_removal_plan — an epic tracking a cross-repository child', () => {
	it('removes a same-repository order and keeps the external row', () => {
		const outcome = epic_remove_plan.build_removal_plan({
			epic_number: EPIC_NUMBER,
			body: BODY,
			labels: ['epic'],
			path: [890, 891],
			recorded: RECORDED,
			repo: EPIC_FIXTURE_REPO,
		})
		if ('error' in outcome) throw new Error(outcome.error)

		expect(links_of(outcome.plan.removed)).toEqual(['890->891'])
		expect(outcome.plan.body).toContain(EXTERNAL_ROW)
		expect(outcome.plan.body).not.toContain(CHAIN)
	})
})
