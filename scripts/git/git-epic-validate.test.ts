import { describe, expect, it } from 'vitest'
import { git_epic_body } from './git-epic-body'
import { git_epic_validate, type EpicSubject } from './git-epic-validate'

const CHILDREN = [101, 102]
const RATIONALE = 'Split so each half can merge on its own.'
const EPIC_NUMBER = 700
const LABEL_CHECK = 'epic label'
const TASK_LIST_CHECK = 'child task list'
const DEPENDENCIES_CHECK = 'dependencies section'
const ELIGIBILITY_CHECK = 'auto-close eligibility'

function generated_body(is_ordered: boolean): string {
	return git_epic_body.build_epic_body({
		children: CHILDREN,
		rationale: RATIONALE,
		is_ordered,
	})
}

function to_subject(overrides: Partial<EpicSubject>): EpicSubject {
	return {
		number: EPIC_NUMBER,
		labels: ['epic'],
		body: generated_body(false),
		...overrides,
	}
}

function is_valid(subject: EpicSubject): boolean {
	return git_epic_validate.is_epic_valid(git_epic_validate.validate_epic(subject))
}

function check_names_failing(subject: EpicSubject): Array<string> {
	return git_epic_validate
		.validate_epic(subject)
		.filter((result) => !result.is_passing)
		.map((result) => result.name)
}

describe('git_epic_validate.validate_epic — a generated epic', () => {
	// The generator's output is asserted against the validator, so the two cannot drift apart.
	it('accepts an unordered epic produced by the body builder', () => {
		expect(is_valid(to_subject({}))).toBe(true)
	})

	it('accepts an ordered epic produced by the body builder', () => {
		const subject = to_subject({ body: generated_body(true) })

		expect(is_valid(subject)).toBe(true)
	})
})

describe('git_epic_validate.validate_epic — silent failure modes', () => {
	it('fails when the epic label is missing', () => {
		expect(check_names_failing(to_subject({ labels: [] }))).toContain(LABEL_CHECK)
	})

	// A bare `#N` link produces a cross-link with no tracking, so the auto-close never matches it.
	it('fails when the child list is written as bare issue links', () => {
		const body = '## Progress\n\n#101\n#102\n\n## Dependencies\n\nNone'

		expect(check_names_failing(to_subject({ body }))).toContain(TASK_LIST_CHECK)
	})

	it('fails when the dependencies section is prose instead of the arrow form', () => {
		const body = '## Dependencies\n\n#102 depends on #101\n\n## Progress\n\n- [ ] #101\n- [ ] #102'

		expect(check_names_failing(to_subject({ body }))).toContain(DEPENDENCIES_CHECK)
	})

	it('reports an epic that tracks a child in another repository', () => {
		const body = '## Progress\n\n- [ ] #101\n- [ ] joshuafolkken/app-kit#144'

		expect(check_names_failing(to_subject({ body }))).toContain(ELIGIBILITY_CHECK)
	})

	it('fails every body check when the body is missing entirely', () => {
		const failing = check_names_failing(to_subject({ body: undefined }))

		expect(failing).toContain(TASK_LIST_CHECK)
		expect(failing).toContain(DEPENDENCIES_CHECK)
	})
})

const QUOTED_TEMPLATE_BODY = [
	'## Dependencies',
	'',
	'see the template:',
	'',
	'```md',
	'None — the children are independent; any execution order works.',
	'```',
	'',
	'## Progress',
	'',
	'- [ ] #101',
].join('\n')

describe('git_epic_validate.validate_epic — quoted template', () => {
	// An epic body may quote the template itself, and a declaration inside that fence is an
	// illustration. Counting it would pass an epic whose real Dependencies section says nothing —
	// the exact case this check exists to catch.
	it('does not accept an unordered declaration that only appears inside a fenced block', () => {
		expect(check_names_failing(to_subject({ body: QUOTED_TEMPLATE_BODY }))).toContain(
			DEPENDENCIES_CHECK,
		)
	})
})

describe('git_epic_validate.format_check_report', () => {
	it('names the epic and marks it satisfied when every check passes', () => {
		const results = git_epic_validate.validate_epic(to_subject({}))

		expect(git_epic_validate.format_check_report(EPIC_NUMBER, results)).toContain(
			'✅ Epic #700 satisfies every requirement.',
		)
	})

	it('marks the epic unsatisfied and explains the failing check', () => {
		const results = git_epic_validate.validate_epic(to_subject({ labels: [] }))
		const report = git_epic_validate.format_check_report(EPIC_NUMBER, results)

		expect(report).toContain('❌ Epic #700 does not satisfy every requirement.')
		expect(report).toContain(`✖ ${LABEL_CHECK}`)
		expect(report).toContain('the auto-close only looks at labelled issues')
	})

	it('lists the tracked children when the task list is readable', () => {
		const results = git_epic_validate.validate_epic(to_subject({}))

		expect(git_epic_validate.format_check_report(EPIC_NUMBER, results)).toContain('#101, #102')
	})
})
