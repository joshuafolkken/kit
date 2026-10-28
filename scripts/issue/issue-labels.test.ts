import { CLASSIFICATION_LABELS } from '#scripts/ci/pr-classification'
import { describe, expect, it } from 'vitest'
import {
	ALL_LABELS,
	ALREADY_DONE_LABEL,
	AUTO_OK_LABEL,
	BUG_LABEL,
	DEFERRED_LABEL,
	EPIC_LABEL,
	EXEMPT_FROM_PROVISIONING,
	FILING_ROUTE_LABELS,
	has_any_label,
	has_label_name,
	has_parked_label,
	IN_PROGRESS_LABEL,
	INTERRUPT_ROUTE_LABEL,
	label_name_of,
	MEASURED_LABEL,
	MEASURED_UNMET_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	NOT_BEFORE_LABEL,
	NOT_DIRECTLY_RUNNABLE_LABELS,
	parked_label_of,
	PARKED_LABELS,
	PLANNED_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RELEASE_CLASSIFICATION_LABELS,
	RELEASE_LABEL,
	REPOSITORY_LABELS,
	REVIEW_CAP_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
	RUN_STALLED_LABEL,
	SPLIT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
	WORKFLOW_LABELS,
} from './issue-labels'

// The label names are the contract between these scripts and GitHub, and every one of them fails
// silently when it drifts: an epic filtered on the wrong name is never closed, and an issue matched
// on the wrong name is never excluded.

// Spelled out rather than compared to the constants themselves, which would assert nothing.
const EPIC_SPELLING = 'epic'
// The same label as GitHub answers with in a repository that created it before these scripts did.
const EPIC_CREATED_CASING = 'Epic'
const UNRELATED_SPELLING = 'bug'
const IN_PROGRESS_SPELLING = 'in-progress'
const IN_PROGRESS_CREATED_CASING = 'In-Progress'
const NEEDS_DECISION_SPELLING = 'needs-decision'
const AUTO_OK_SPELLING = 'auto-ok'
const NEEDS_HUMAN_REVIEW_SPELLING = 'needs-human-review'
// joshuafolkken/kit#1679: the exit for an Issue whose work a run verified is already merged.
const ALREADY_DONE_SPELLING = 'already-done'
// joshuafolkken/kit#4475: the mark `run:carry --end` collects a measurement-only lane by.
const MEASURED_SPELLING = 'measured'
// joshuafolkken/kit#4958: the shortfall `effect:audit` reads a retirement candidate off.
const MEASURED_UNMET_SPELLING = 'measured:unmet'
// joshuafolkken/kit#4102: the park a mechanical failure gets, kept apart from a person's decision.
const RUN_STALLED_SPELLING = 'run:stalled'
const RUN_STALLED_CREATED_CASING = 'Run:Stalled'
// joshuafolkken/kit#4103: the exclusion `issue-auto-ok.ts` reads, now provisioned so a person can apply it.
const DEFERRED_SPELLING = 'deferred'
const NOT_DIRECTLY_RUNNABLE_COUNT = 5
const PARKED_COUNT = 3
// joshuafolkken/kit#1083: the route labels are the same GitHub contract, and the aggregation query
// (`?labels=route:split`) fails silently on a drifted name exactly as the others do.
const REVIEW_CAP_ROUTE_SPELLING = 'route:review-cap'
const SPLIT_ROUTE_SPELLING = 'route:split'
const TIER_A_ROUTE_SPELLING = 'route:tier-a'
// joshuafolkken/kit#1518: the interrupt route, whose aggregation query is what makes "how often did
// a serious defect have to bypass the cap" answerable at all.
const INTERRUPT_ROUTE_SPELLING = 'route:interrupt'
const FILING_ROUTE_COUNT = 4
// joshuafolkken/kit#4383: the rank key above priority:high, created by hand in kit before this landed.
const PRIORITY_CRITICAL_SPELLING = 'priority:critical'

describe('the label names', () => {
	it.each([
		[EPIC_LABEL, EPIC_SPELLING],
		[IN_PROGRESS_LABEL, IN_PROGRESS_SPELLING],
		[NEEDS_DECISION_LABEL, NEEDS_DECISION_SPELLING],
		[RUN_STALLED_LABEL, RUN_STALLED_SPELLING],
		[AUTO_OK_LABEL, AUTO_OK_SPELLING],
		[NEEDS_HUMAN_REVIEW_LABEL, NEEDS_HUMAN_REVIEW_SPELLING],
		[ALREADY_DONE_LABEL, ALREADY_DONE_SPELLING],
		[MEASURED_LABEL, MEASURED_SPELLING],
		[MEASURED_UNMET_LABEL, MEASURED_UNMET_SPELLING],
		[DEFERRED_LABEL, DEFERRED_SPELLING],
		[INTERRUPT_ROUTE_LABEL, INTERRUPT_ROUTE_SPELLING],
		[REVIEW_CAP_ROUTE_LABEL, REVIEW_CAP_ROUTE_SPELLING],
		[SPLIT_ROUTE_LABEL, SPLIT_ROUTE_SPELLING],
		[TIER_A_ROUTE_LABEL, TIER_A_ROUTE_SPELLING],
		[PRIORITY_CRITICAL_LABEL, PRIORITY_CRITICAL_SPELLING],
	])('%s is spelled exactly as GitHub holds it', (actual, expected) => {
		expect(actual).toBe(expected)
	})
})

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
			RUN_SOLO_LABEL,
			RUN_LANE_LABEL,
			PRIORITY_CRITICAL_LABEL,
			PRIORITY_HIGH_LABEL,
			RELEASE_LABEL,
			AUTO_OK_LABEL,
			NEEDS_DECISION_LABEL,
			RUN_STALLED_LABEL,
			NEEDS_HUMAN_REVIEW_LABEL,
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

describe('NOT_DIRECTLY_RUNNABLE_LABELS', () => {
	it.each([
		EPIC_LABEL,
		IN_PROGRESS_LABEL,
		NEEDS_DECISION_LABEL,
		RUN_STALLED_LABEL,
		ALREADY_DONE_LABEL,
	])('holds %s', (label) => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.has(label)).toBe(true)
	})

	// Opting in is what makes an issue runnable outside an epic, so a set that also excluded it would
	// filter out every candidate the pickup exists to find.
	it('does not hold the opt-in label', () => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.has(AUTO_OK_LABEL)).toBe(false)
	})

	// joshuafolkken/kit#1125: this label withholds the *end* of a run, not its start. Excluded here it
	// would never be offered, so the work it asks a person to look at would never be produced — the
	// label would silently become a second `needs-decision`.
	it('does not hold the human-review label', () => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.has(NEEDS_HUMAN_REVIEW_LABEL)).toBe(false)
	})

	// joshuafolkken/kit#1518: a route label is informational — it says which filing produced an issue,
	// never whether the issue may run. Added here, `route:interrupt` would make every interrupt
	// invisible to `epic:next`, so the defect the cap now lets through would be filed and then never
	// offered — the "filed but never run" state the rule body warns is no better than a lost comment.
	it.each(FILING_ROUTE_LABELS.map((label) => label.name))('does not hold %s', (name) => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.has(name)).toBe(false)
	})

	it('holds those five and nothing else', () => {
		expect(NOT_DIRECTLY_RUNNABLE_LABELS.size).toBe(NOT_DIRECTLY_RUNNABLE_COUNT)
	})
})

describe('has_any_label', () => {
	it('matches a label present in the set', () => {
		expect(has_any_label([{ name: IN_PROGRESS_SPELLING }], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(true)
	})

	// GitHub keeps the casing a label was created with and treats `Epic` and `epic` as one label, so
	// a repository that predates these scripts can answer with either spelling.
	it('matches regardless of the casing GitHub answers with', () => {
		expect(has_any_label([{ name: EPIC_CREATED_CASING }], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(true)
	})

	it('does not match an unrelated label', () => {
		expect(has_any_label([{ name: UNRELATED_SPELLING }], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(false)
	})

	it('treats a missing labels field as no labels', () => {
		expect(has_any_label(undefined, NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(false)
	})

	it('treats an empty labels field as no labels', () => {
		expect(has_any_label([], NOT_DIRECTLY_RUNNABLE_LABELS)).toBe(false)
	})
})

// The same rule for the one shape `has_any_label` cannot take: bare label names, which is what
// `EpicChild.labels` carries (joshuafolkken/kit#1476).
describe('has_label_name', () => {
	it('matches the label it is given', () => {
		expect(has_label_name([IN_PROGRESS_SPELLING], IN_PROGRESS_LABEL)).toBe(true)
	})

	it('matches a bare name regardless of the casing GitHub answers with', () => {
		expect(has_label_name([EPIC_CREATED_CASING], EPIC_LABEL)).toBe(true)
	})

	it('does not match a bare name that is an unrelated label', () => {
		expect(has_label_name([UNRELATED_SPELLING], EPIC_LABEL)).toBe(false)
	})

	it('treats an empty label list as no labels', () => {
		expect(has_label_name([], EPIC_LABEL)).toBe(false)
	})
})

// joshuafolkken/kit#4102: one set every "is it parked" reading shares.
describe('PARKED_LABELS', () => {
	it.each([NEEDS_DECISION_LABEL, RUN_STALLED_LABEL, ALREADY_DONE_LABEL])('holds %s', (label) => {
		expect(PARKED_LABELS.has(label)).toBe(true)
	})

	it('holds those three and nothing else', () => {
		expect(PARKED_LABELS.size).toBe(PARKED_COUNT)
	})
})

describe('has_parked_label', () => {
	it('reads a run:stalled child as parked, whatever casing GitHub answers with', () => {
		expect(has_parked_label([RUN_STALLED_CREATED_CASING])).toBe(true)
	})

	it('reads a needs-decision child as parked', () => {
		expect(has_parked_label([UNRELATED_SPELLING, NEEDS_DECISION_SPELLING])).toBe(true)
	})

	it('does not read in-progress or the human-review label as parked', () => {
		expect(has_parked_label([IN_PROGRESS_SPELLING, NEEDS_HUMAN_REVIEW_SPELLING])).toBe(false)
	})
})

// joshuafolkken/kit#4746: an `--only` run's stop names the park each unmerged issue sits on.
describe('parked_label_of', () => {
	it('names the park label, whatever casing GitHub answers with', () => {
		expect(parked_label_of([UNRELATED_SPELLING, RUN_STALLED_CREATED_CASING])).toBe(
			RUN_STALLED_SPELLING,
		)
	})

	it('names no label for an issue that is not parked', () => {
		expect(parked_label_of([IN_PROGRESS_SPELLING])).toBeUndefined()
	})
})

// A removal names the label in the request path, so the stored spelling is what it has to send —
// not the lowercase constant it matched against (joshuafolkken/kit#1794).
describe('label_name_of', () => {
	it('answers the stored spelling rather than the name it was asked for', () => {
		expect(label_name_of([IN_PROGRESS_CREATED_CASING], IN_PROGRESS_LABEL)).toBe(
			IN_PROGRESS_CREATED_CASING,
		)
	})

	it('answers the exact name when the casing already matches', () => {
		expect(label_name_of([IN_PROGRESS_SPELLING], IN_PROGRESS_LABEL)).toBe(IN_PROGRESS_SPELLING)
	})

	it('answers undefined when the label is not there', () => {
		expect(label_name_of([UNRELATED_SPELLING], IN_PROGRESS_LABEL)).toBeUndefined()
	})

	it('answers undefined for an empty label list', () => {
		expect(label_name_of([], IN_PROGRESS_LABEL)).toBeUndefined()
	})
})
