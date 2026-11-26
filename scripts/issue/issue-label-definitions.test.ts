import { CLASSIFICATION_LABELS } from '#scripts/ci/pr-classification'
import { describe, expect, it } from 'vitest'
import {
	FILING_ROUTE_LABELS,
	RELEASE_CLASSIFICATION_LABELS,
	REPOSITORY_LABELS,
	WORKFLOW_LABELS,
} from './issue-label-definitions'
import {
	ALL_LABELS,
	ALREADY_DONE_LABEL,
	AUTO_OK_LABEL,
	BUG_LABEL,
	DEFERRED_LABEL,
	EPIC_LABEL,
	EXEMPT_FROM_PROVISIONING,
	IN_PROGRESS_LABEL,
	INTERRUPT_ROUTE_LABEL,
	MEASURED_LABEL,
	MEASURED_UNMET_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NOT_BEFORE_LABEL,
	PLAN_UNVERIFIED_LABEL,
	PLANNED_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RELEASE_LABEL,
	REVIEW_CAP_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
	RUN_STALLED_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
} from './issue-labels'

const FILING_ROUTE_COUNT = 4

describe('FILING_ROUTE_LABELS', () => {
	// The provisioning source: one entry per route label, each with the color and description a repo
	// is created with. A route added to the constants but not here would never be provisioned.
	it('carries one entry per route label', () => {
		expect(FILING_ROUTE_LABELS.map((label) => label.name)).toStrictEqual([
			INTERRUPT_ROUTE_LABEL,
			REVIEW_CAP_ROUTE_LABEL,
			SPLIT_ROUTE_LABEL,
			TIER_A_ROUTE_LABEL,
		])
	})

	it('holds exactly the four route labels', () => {
		expect(FILING_ROUTE_LABELS).toHaveLength(FILING_ROUTE_COUNT)
	})

	it('gives every route a non-empty color and description', () => {
		for (const label of FILING_ROUTE_LABELS) {
			expect(label.color).toMatch(/^[0-9a-f]{6}$/u)
			expect(label.description.length).toBeGreaterThan(0)
		}
	})
})

describe('WORKFLOW_LABELS', () => {
	// What josh start provisions: every label a run applies, and every one a person applies too.
	it('carries the workflow, opt-in, parking, review and bug labels, then every route label', () => {
		expect(WORKFLOW_LABELS.map((label) => label.name)).toStrictEqual([
			EPIC_LABEL,
			IN_PROGRESS_LABEL,
			PLANNED_LABEL,
			PLAN_UNVERIFIED_LABEL,
			RUN_SOLO_LABEL,
			RUN_LANE_LABEL,
			PRIORITY_CRITICAL_LABEL,
			PRIORITY_HIGH_LABEL,
			RELEASE_LABEL,
			AUTO_OK_LABEL,
			NEEDS_DECISION_LABEL,
			RUN_STALLED_LABEL,
			NEEDS_HUMAN_REVIEW_LABEL,
			NEEDS_HUMAN_MERGE_LABEL,
			ALREADY_DONE_LABEL,
			MEASURED_LABEL,
			MEASURED_UNMET_LABEL,
			DEFERRED_LABEL,
			NOT_BEFORE_LABEL,
			BUG_LABEL,
			...FILING_ROUTE_LABELS.map((label) => label.name),
		])
	})
})

describe('REPOSITORY_LABELS', () => {
	// A managed label that is never provisioned cannot be applied in a repository `josh start` set
	// up — the gap joshuafolkken/kit#3760 found for `auto-ok`.
	it('provisions every managed label not exempted with a reason', () => {
		const provisioned = new Set(REPOSITORY_LABELS.map((label) => label.name))
		const missing = [...ALL_LABELS].filter(
			(name) => !provisioned.has(name) && !EXEMPT_FROM_PROVISIONING.has(name),
		)

		expect(missing).toStrictEqual([])
	})

	it('exempts only managed labels, each with a reason', () => {
		for (const [name, reason] of EXEMPT_FROM_PROVISIONING) {
			expect(ALL_LABELS.has(name)).toBe(true)
			expect(reason.length).toBeGreaterThan(0)
		}
	})

	// joshuafolkken/kit#4109: no run applies or reads it, so `josh start` no longer creates it.
	it('neither manages nor provisions the retired review-round2-skipped label', () => {
		const retired = 'review-round2-skipped'

		expect(ALL_LABELS.has(retired)).toBe(false)
		expect(REPOSITORY_LABELS.map((label) => label.name)).not.toContain(retired)
	})

	// joshuafolkken/kit#4108: nothing reads a depth label, so `josh start` no longer creates them.
	it.each(['depth:0', 'depth:1', 'depth:2'])(
		'neither manages nor provisions the retired %s',
		(retired) => {
			expect(ALL_LABELS.has(retired)).toBe(false)
			expect(REPOSITORY_LABELS.map((label) => label.name)).not.toContain(retired)
		},
	)

	it('gives every provisioned label a six-digit hex color and a description', () => {
		for (const label of REPOSITORY_LABELS) {
			expect(label.color).toMatch(/^[0-9a-f]{6}$/u)
			expect(label.description.length).toBeGreaterThan(0)
		}
	})
})

// joshuafolkken/kit#4103: `issue-auto-ok.ts` reads it, yet a `josh start` repository lacked it.
describe('the deferred label', () => {
	it('is managed and provisioned', () => {
		expect(ALL_LABELS.has(DEFERRED_LABEL)).toBe(true)
		expect(REPOSITORY_LABELS.map((label) => label.name)).toContain(DEFERRED_LABEL)
	})
})

describe('RELEASE_CLASSIFICATION_LABELS', () => {
	// The labels pr-classification.yml requires exactly one of, read by the check from the same list.
	it('defines the five release classifications the check reads, each with a color and description', () => {
		expect(RELEASE_CLASSIFICATION_LABELS.map((label) => label.name)).toStrictEqual([
			...CLASSIFICATION_LABELS,
		])

		for (const label of RELEASE_CLASSIFICATION_LABELS) {
			expect(label.color).toMatch(/^[0-9a-f]{6}$/u)
			expect(label.description.length).toBeGreaterThan(0)
		}
	})

	it('is provisioned together with the workflow labels', () => {
		expect(REPOSITORY_LABELS).toStrictEqual([...WORKFLOW_LABELS, ...RELEASE_CLASSIFICATION_LABELS])
	})
})
