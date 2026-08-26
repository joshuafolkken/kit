import { describe, expect, it } from 'vitest'
import { git_epic_parse } from './git-epic-parse'
import { git_epic_promote, type PromoteInput } from './git-epic-promote'
import { git_epic_validate } from './git-epic-validate'
import { EPIC_LABEL } from './issue-labels'

const EPIC_NUMBER = 858
const CHILDREN = [101, 102, 103]
const RATIONALE = 'The request turned out to be three independent pieces.'
const PROGRESS_HEADING = '## Progress'
const BACKGROUND_HEADING = '## 背景'
const ORIGIN_REFERENCE = 'joshuafolkken/app-kit#12'
const FIRST_CHILD_ROW = '- [ ] #101'
const ORIGINAL_BODY: string = [
	BACKGROUND_HEADING,
	'',
	'A discussion that concluded the work is really three issues.',
	'',
	'## 期待結果',
	'',
	'Three separate deliverables.',
].join('\n')

function promote(overrides: Partial<PromoteInput> = {}): string {
	return git_epic_promote.build_promoted_body({
		body: ORIGINAL_BODY,
		children: CHILDREN,
		rationale: RATIONALE,
		is_ordered: false,
		epic_number: EPIC_NUMBER,
		...overrides,
	})
}

describe('git_epic_promote.build_promoted_body — the original is kept', () => {
	// The discussion that concluded "this is really several issues" usually *is* the split rationale.
	// Replacing the body would throw away the reason the split was made.
	it('keeps every line of the existing body', () => {
		const promoted = promote()

		for (const line of ORIGINAL_BODY.split('\n')) expect(promoted).toContain(line)
	})

	it('appends the epic sections after the original, not before it', () => {
		const promoted = promote()

		expect(promoted.indexOf(BACKGROUND_HEADING)).toBeLessThan(promoted.indexOf(PROGRESS_HEADING))
	})

	it('says what happened to the issue, under one heading', () => {
		expect(promote()).toContain(git_epic_promote.PROMOTED_HEADING)
	})

	it('handles an issue whose body was empty', () => {
		expect(promote({ body: '' })).toContain(PROGRESS_HEADING)
	})

	it('handles an issue with no body at all', () => {
		expect(promote({ body: undefined })).toContain(PROGRESS_HEADING)
	})
})

describe('git_epic_promote.build_promoted_body — what the tooling reads', () => {
	it('tracks every child as a task-list row', () => {
		expect(git_epic_parse.parse_task_list_issue_numbers(promote())).toEqual(CHILDREN)
	})

	it('declares the dependencies as a chain when ordered', () => {
		expect(git_epic_parse.has_declared_dependency_chain(promote({ is_ordered: true }))).toBe(true)
	})

	it('declares the children independent when not ordered', () => {
		expect(git_epic_parse.has_unordered_declaration(promote())).toBe(true)
	})

	it('names the epic in the run command, since the number is already known', () => {
		expect(promote()).toContain(`epicrun #${String(EPIC_NUMBER)}`)
	})

	it('carries the supplied rationale', () => {
		expect(promote()).toContain(RATIONALE)
	})

	it('carries an origin backlink when one was supplied', () => {
		expect(promote({ origin: ORIGIN_REFERENCE })).toContain(ORIGIN_REFERENCE)
	})
})

// `josh epic:check` is what tells a person the epic is tracked correctly, so a promoted issue has to
// satisfy the same four requirements a created one does.
describe('git_epic_promote — a promoted issue passes epic:check', () => {
	it('satisfies every requirement once the label is applied', () => {
		const results = git_epic_validate.validate_epic({
			number: EPIC_NUMBER,
			labels: [EPIC_LABEL],
			body: promote(),
		})

		expect(git_epic_validate.is_epic_valid(results)).toBe(true)
	})

	it('satisfies them for an ordered split too', () => {
		const results = git_epic_validate.validate_epic({
			number: EPIC_NUMBER,
			labels: [EPIC_LABEL],
			body: promote({ is_ordered: true }),
		})

		expect(git_epic_validate.is_epic_valid(results)).toBe(true)
	})
})

// A second append would leave two task lists and two contradictory `## Dependencies` sections, and
// the auto-close would read whichever it matched first — so any body that already tracks children
// has to be refused rather than appended to.
describe('git_epic_promote.has_conflicting_tracking', () => {
	it('recognizes a body the promotion already ran on', () => {
		expect(git_epic_promote.has_conflicting_tracking(promote())).toBe(true)
	})

	// An epic created by `josh epic` carries a task list without ever having been promoted.
	it('recognizes an epic that was created rather than promoted', () => {
		const created = [
			'## Split rationale',
			'',
			RATIONALE,
			'',
			PROGRESS_HEADING,
			'',
			FIRST_CHILD_ROW,
		].join('\n')

		expect(git_epic_promote.has_conflicting_tracking(created)).toBe(true)
	})

	// The promoted body keeps everything that was there, and every parser scans the whole thing — so
	// somebody's pre-existing checklist would become a set of tracked children.
	it('recognizes a pre-existing task list on an ordinary issue', () => {
		expect(git_epic_promote.has_conflicting_tracking('- [x] #850')).toBe(true)
	})

	it('accepts an issue with no task list at all', () => {
		expect(git_epic_promote.has_conflicting_tracking(ORIGINAL_BODY)).toBe(false)
	})

	it('is not fooled by a bare issue reference, which tracks nothing', () => {
		expect(git_epic_promote.has_conflicting_tracking('see #850 for context')).toBe(false)
	})

	it('handles a missing body', () => {
		expect(git_epic_promote.has_conflicting_tracking(undefined)).toBe(false)
	})
})

describe('git_epic_promote.conflict_reason', () => {
	it('names the rows it found, so the refusal is actionable', () => {
		expect(git_epic_promote.conflict_reason('- [ ] #850')).toContain('#850')
	})

	it('says so plainly when the promotion already ran', () => {
		expect(git_epic_promote.conflict_reason(promote())).toContain('already carries')
	})
})

describe('git_epic_promote.is_tracking_complete', () => {
	it('accepts a body tracking every child', () => {
		expect(git_epic_promote.is_tracking_complete(promote(), CHILDREN)).toBe(true)
	})

	it('rejects a body missing one of them', () => {
		expect(git_epic_promote.is_tracking_complete(promote(), [...CHILDREN, 999])).toBe(false)
	})

	it('rejects a body with no dependency declaration', () => {
		expect(git_epic_promote.is_tracking_complete(FIRST_CHILD_ROW, [101])).toBe(false)
	})
})
