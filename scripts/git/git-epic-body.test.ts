import { describe, expect, it } from 'vitest'
import { git_epic_body } from './git-epic-body'
import { git_epic_parse, UNORDERED_DEPENDENCIES } from './git-epic-parse'

const CHILDREN = [101, 102, 103]
const RATIONALE = 'Split so the parser and the reporter can merge independently.'
const EPIC_NUMBER = 858
const ORIGIN_HEADING = '## Origin'
const ORIGIN_REFERENCE = 'joshuafolkken/app-kit#144'
const BLANK_RATIONALE = ' '.repeat(3)

function build(is_ordered: boolean): string {
	return git_epic_body.build_epic_body({ children: CHILDREN, rationale: RATIONALE, is_ordered })
}

describe('git_epic_body.build_epic_body — child task list', () => {
	// The auto-close reads nothing but this syntax, so the generated body is asserted through the
	// very parser that consumes it rather than against a hand-written string.
	it('emits children the auto-close parser can read back', () => {
		expect(git_epic_parse.parse_task_list_issue_numbers(build(false))).toStrictEqual(CHILDREN)
	})

	it('writes task-list rows, not bare issue links', () => {
		expect(build(false)).toContain('- [ ] #101')
		expect(build(false)).not.toMatch(/^#101/mu)
	})

	it('does not mark any child as already complete', () => {
		expect(build(false)).not.toContain('- [x]')
	})
})

describe('git_epic_body.build_epic_body — dependencies', () => {
	it('declares an unordered batch with the literal the check looks for', () => {
		expect(build(false)).toContain(UNORDERED_DEPENDENCIES)
	})

	it('leaves no arrow chain for an unordered batch', () => {
		expect(git_epic_parse.has_declared_dependency_chain(build(false))).toBe(false)
	})

	it('emits an arrow chain the order warning can detect when ordered', () => {
		expect(git_epic_parse.has_declared_dependency_chain(build(true))).toBe(true)
		expect(build(true)).toContain('#101 -> #102 -> #103')
	})

	it('does not emit the unordered literal when the batch is ordered', () => {
		expect(build(true)).not.toContain(UNORDERED_DEPENDENCIES)
	})
})

describe('git_epic_body.build_epic_body — execution and rationale', () => {
	// `epicrun` takes the epic, not the children: it re-reads state from GitHub each round, so an
	// interrupted run resumes without anyone retyping the remaining numbers (joshuafolkken/kit#861).
	it('prints the epicrun command rather than a list of children', () => {
		const body = build(false)

		expect(body).toContain('epicrun')
		expect(body).not.toContain('queue #101')
	})

	it('carries the supplied rationale', () => {
		expect(build(false)).toContain(RATIONALE)
	})

	it('substitutes a visible placeholder when no rationale was supplied', () => {
		const body = git_epic_body.build_epic_body({
			children: CHILDREN,
			rationale: BLANK_RATIONALE,
			is_ordered: false,
		})

		expect(body).toContain('<why the work was split this way>')
	})
})

describe('git_epic_body.build_epic_body — origin backlink', () => {
	it('omits the origin section unless a backlink was supplied', () => {
		expect(build(false)).not.toContain(ORIGIN_HEADING)
	})

	// A checkbox row referencing another repository disables the auto-close by design, so the
	// backlink has to stay plain prose.
	it('writes an origin backlink without checkbox syntax', () => {
		const body = git_epic_body.build_epic_body({
			children: CHILDREN,
			rationale: RATIONALE,
			is_ordered: false,
			origin: ORIGIN_REFERENCE,
		})

		expect(body).toContain(ORIGIN_HEADING)
		expect(body).toContain(ORIGIN_REFERENCE)
		expect(git_epic_parse.has_external_task_list_entry(body)).toBe(false)
	})
})

describe('git_epic_body.build_dependency_pairs', () => {
	it('records no relation for an unordered batch', () => {
		expect(git_epic_body.build_dependency_pairs(CHILDREN, false)).toStrictEqual([])
	})

	// The pairs must be the same pairs the arrow chain names, which is the whole reason both are
	// derived from one input.
	it('chains each child to its predecessor when ordered', () => {
		expect(git_epic_body.build_dependency_pairs(CHILDREN, true)).toStrictEqual([
			{ blocked: 102, blocker: 101 },
			{ blocked: 103, blocker: 102 },
		])
	})

	it('produces no pair for a single-child batch', () => {
		expect(git_epic_body.build_dependency_pairs([101], true)).toStrictEqual([])
	})
})

describe('git_epic_body.format_run_command', () => {
	it('names the epic once its number is known', () => {
		expect(git_epic_body.format_run_command(EPIC_NUMBER)).toBe(`epicrun #${String(EPIC_NUMBER)}`)
	})

	// A new epic's body is written before the issue exists, so the number is substituted afterwards.
	it('leaves a visible placeholder while the number is unknown', () => {
		expect(git_epic_body.format_run_command(undefined)).toContain(git_epic_body.EPIC_PLACEHOLDER)
	})

	it('never lists the children, which epicrun does not take', () => {
		expect(git_epic_body.format_run_command(EPIC_NUMBER)).not.toContain('#101')
	})
})
