import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { describe, expect, it } from 'vitest'
import { gate_plan } from './gate-plan'
import { gate_static_group } from './gate-static-group'

// joshuafolkken/kit#5215: CI runs the static set as one matrix leg per group. **The partition's whole
// risk is a check that no leg runs**, which would leave CI verifying less than the local gate while
// every leg is green — so the union is read from the gate's own list, not restated here.
const STATIC_LABELS = gate_plan.STATIC_CHECKS.map((check) => check.label)
const GROUP_NAMES = Object.keys(gate_static_group.STATIC_GROUPS)
const GROUPED_LABELS = Object.values(gate_static_group.STATIC_GROUPS).flat()
const MATRIX_JOB = 'static-checks'
const LINT_GROUP = 'lint'

describe('the static groups partition the static checks', () => {
	it.each(STATIC_LABELS)('puts %j in exactly one group', (label) => {
		expect(GROUPED_LABELS.filter((grouped) => grouped === label)).toHaveLength(1)
	})

	it('names no label the static set does not have', () => {
		expect(GROUPED_LABELS.filter((label) => !STATIC_LABELS.includes(label))).toEqual([])
	})
})

describe('the workflow matrix runs every group', () => {
	it('lists exactly the groups the gate defines', () => {
		const job = ci_yml_fixture.find_job(ci_yml_fixture.RUNTIME_CI_YML, MATRIX_JOB)

		expect(job?.strategy?.matrix?.['group']).toEqual(GROUP_NAMES)
	})
})

describe('group_of', () => {
	it.each(GROUP_NAMES)('reads the group %j from its flag', (name) => {
		expect(gate_static_group.group_of(`${gate_static_group.STATIC_GROUP_FLAG_PREFIX}${name}`)).toBe(
			name,
		)
	})

	it.each([`${gate_static_group.STATIC_GROUP_FLAG_PREFIX}nope`, '--verbose', LINT_GROUP])(
		'reads no group from %j',
		(argument) => {
			expect(gate_static_group.group_of(argument)).toBeUndefined()
		},
	)

	it('does not read an inherited object key as a group', () => {
		expect(
			gate_static_group.group_of(`${gate_static_group.STATIC_GROUP_FLAG_PREFIX}toString`),
		).toBeUndefined()
	})
})

describe('narrow_checks', () => {
	it('keeps every check when no group is named', () => {
		expect(gate_static_group.narrow_checks(gate_plan.STATIC_CHECKS, undefined)).toEqual(
			gate_plan.STATIC_CHECKS,
		)
	})

	it('keeps only the named group, in the plan order', () => {
		const labels = gate_static_group
			.narrow_checks(gate_plan.GATE_CHECKS, 'types')
			.map((check) => check.label)

		expect(labels).toEqual([gate_plan.TYPE_CHECK_LABEL, gate_plan.EXPORTS_LABEL])
	})

	it('finds the group among the other arguments', () => {
		const flag = `${gate_static_group.STATIC_GROUP_FLAG_PREFIX}${LINT_GROUP}`

		expect(gate_static_group.find_group(['--verbose', '--no-unit', flag])).toBe(LINT_GROUP)
	})
})
