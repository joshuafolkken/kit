import { describe, expect, it } from 'vitest'
import type { BacklogIssue } from './epic-bundle'
import { epic_bundle_cli } from './epic-bundle-cli'
import { epic_bundle_evidence } from './epic-bundle-evidence'

// The facts behind the order `epic:bundle` prints (joshuafolkken/kit#1737).
//
// Both readings were already in hand when the verdict was composed, and neither reached the output —
// so checking whether an issue really belongs after another meant opening both bodies and
// re-deriving what the command had just read. What is asserted below is that each fact appears with
// the direction it points, and that nothing here tells the caller where to put the issue.

const REPO = 'joshuafolkken/kit'
const SUBJECT_NUMBER = 3
const OTHER_NUMBER = 2
// The prose reference that makes the two a candidate pair, written on each side in turn.
const SUBJECT_BODY = 'follows #2'
const OTHER_BODY = 'blocks #3'
const SUBJECT_NAMES_OTHER = '#3 names #2 in its body — that points to #2 first'
const OTHER_NAMES_SUBJECT = '#2 names #3 in its body — that points to #3 first'
const CREATE_DECISION = {
	action: 'create_epic' as const,
	epics: [],
	candidates: [OTHER_NUMBER],
	reason: '',
}

function issue(number: number, options: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...options }
}

function blocked_by(number: number): Array<{ repo: string; number: number }> {
	return [{ repo: REPO, number }]
}

function rendered(subject: BacklogIssue, other: BacklogIssue): string {
	return epic_bundle_evidence.format_evidence(subject, [other]).join('\n')
}

describe('epic_bundle_evidence.format_evidence — a recorded blocked-by', () => {
	it('says which issue blocks which, and which of the two comes first', () => {
		const subject = issue(SUBJECT_NUMBER, { blocked_by: blocked_by(OTHER_NUMBER) })
		const lines = rendered(subject, issue(OTHER_NUMBER))

		expect(lines).toContain('#3 is recorded as blocked by #2 — #2 comes first')
	})

	it('reads a dependency recorded on the other issue the other way round', () => {
		const other = issue(OTHER_NUMBER, { blocked_by: blocked_by(SUBJECT_NUMBER) })
		const lines = rendered(issue(SUBJECT_NUMBER), other)

		expect(lines).toContain('#2 is recorded as blocked by #3 — #3 comes first')
	})

	// A blocker in another repository is not this bundle's relation, and reading it as one is what
	// joshuafolkken/kit#1130 recorded onto the wrong issue.
	it('leaves out a blocker that names another repository', () => {
		const subject = issue(SUBJECT_NUMBER, {
			blocked_by: [{ repo: 'joshuafolkken/app-kit', number: OTHER_NUMBER }],
		})

		expect(epic_bundle_evidence.format_evidence(subject, [issue(OTHER_NUMBER)])).toEqual([])
	})
})

describe('epic_bundle_evidence.format_evidence — a body naming the other issue', () => {
	it('says which body names which, and which of the two comes first', () => {
		const lines = rendered(issue(SUBJECT_NUMBER, { body: SUBJECT_BODY }), issue(OTHER_NUMBER))

		expect(lines).toContain(SUBJECT_NAMES_OTHER)
	})

	it('reads a reference written on the other issue the other way round', () => {
		const other = issue(OTHER_NUMBER, { body: OTHER_BODY })
		const lines = rendered(issue(SUBJECT_NUMBER), other)

		expect(lines).toContain(OTHER_NAMES_SUBJECT)
	})

	// Two issues naming each other are two facts pointing opposite ways. Reporting both is the honest
	// answer: the judgement is the reader's, and hiding one of the two would make it for them.
	it('reports both directions when each body names the other', () => {
		const other = issue(OTHER_NUMBER, { body: OTHER_BODY })
		const lines = rendered(issue(SUBJECT_NUMBER, { body: SUBJECT_BODY }), other)

		expect(lines).toContain(SUBJECT_NAMES_OTHER)
		expect(lines).toContain(OTHER_NAMES_SUBJECT)
	})
})

describe('epic_bundle_evidence.format_evidence — nothing to show', () => {
	it('adds no block when neither reading found anything', () => {
		const found = epic_bundle_evidence.format_evidence(issue(SUBJECT_NUMBER), [issue(OTHER_NUMBER)])

		expect(found).toEqual([])
	})

	// An order nobody declared is still not invented, and the line that says so is unchanged.
	it('leaves the existing no-order wording standing on its own', () => {
		const lines = epic_bundle_cli
			.format_order(CREATE_DECISION, issue(SUBJECT_NUMBER), [issue(OTHER_NUMBER)])
			.join('\n')

		expect(lines).toContain('none declared')
		expect(lines).not.toContain(epic_bundle_evidence.EVIDENCE_HEADING.trim())
	})
})

// The material for the judgement, not the judgement: an order depends on intent, so a machine that
// composed the command would be writing a confident order nobody's data supports.
describe('epic_bundle_evidence.format_evidence — it recommends nothing', () => {
	const PLACEMENT_WORDS = ['josh epic', '--add', '--before', '--after', '--ordered', 'Add it to']

	it('names no placement and composes no command', () => {
		const subject = issue(SUBJECT_NUMBER, {
			body: SUBJECT_BODY,
			blocked_by: blocked_by(OTHER_NUMBER),
		})
		const lines = rendered(subject, issue(OTHER_NUMBER))

		for (const word of PLACEMENT_WORDS) expect(lines).not.toContain(word)
	})
})

// `bundle_dependency_links` emits an arrow for any pair of `[subject, ...candidates]`, so an arrow
// between two candidates is ordinary — and evidence taken over the subject's pairs alone would leave
// exactly that arrow with nothing explaining it.
describe('epic_bundle_evidence.format_evidence — a relation between two candidates', () => {
	const THIRD_NUMBER = 4

	it('explains an arrow that does not involve the subject', () => {
		const blocked = issue(THIRD_NUMBER, { blocked_by: blocked_by(OTHER_NUMBER) })
		const lines = epic_bundle_evidence
			.format_evidence(issue(SUBJECT_NUMBER), [issue(OTHER_NUMBER), blocked])
			.join('\n')

		expect(lines).toContain('#4 is recorded as blocked by #2 — #2 comes first')
	})
})

describe('epic_bundle_cli.format_order — the evidence sits under the order', () => {
	it('prints the fact below the arrows it explains', () => {
		const subject = issue(SUBJECT_NUMBER, { blocked_by: blocked_by(OTHER_NUMBER) })
		const lines = epic_bundle_cli.format_order(CREATE_DECISION, subject, [issue(OTHER_NUMBER)])
		const order_index = lines.findIndex((line) => line.includes('Order:'))

		expect(lines[order_index + 1]).toBe(epic_bundle_evidence.EVIDENCE_HEADING)
	})
})
