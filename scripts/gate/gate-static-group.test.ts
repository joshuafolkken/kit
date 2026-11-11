import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { lint_shard } from '#scripts/lint/lint-shard'
import { describe, expect, it } from 'vitest'
import { gate_labels } from './gate-labels'
import { gate_plan } from './gate-plan'
import { gate_static_group } from './gate-static-group'

// joshuafolkken/kit#5215: CI runs the static set as one matrix leg per group. **The partition's whole
// risk is a check that no leg runs**, which would leave CI verifying less than the local gate while
// every leg is green — so the union is read from the gate's own list, not restated here.
const STATIC_LABELS = gate_plan.STATIC_CHECKS.map((check) => check.label)
const GROUP_NAMES = Object.keys(gate_static_group.STATIC_GROUPS)
const GROUPED_LABELS = Object.values(gate_static_group.STATIC_GROUPS).flat()
const MATRIX_JOB = 'static-checks'
// joshuafolkken/kit#7108: the whole-tree lint leg is gone; its shards run in its place.
const LINT_GROUP = 'lint'
const SHARD_GROUPS = Object.entries(gate_static_group.LINT_SHARD_GROUPS)
const SHARD_GROUP_NAMES = Object.keys(gate_static_group.LINT_SHARD_GROUPS)
const FIRST_SHARD_GROUP = 'lint-1'

// The lint check is split by tree, not by check, so each shard group holds it once.
function expected_holders(label: string): number {
	return label === gate_labels.LINT_LABEL ? lint_shard.SHARDS.length : 1
}

describe('the static groups partition the static checks', () => {
	it.each(STATIC_LABELS)('puts %j in exactly one group, the lint check once per shard', (label) => {
		expect(GROUPED_LABELS.filter((grouped) => grouped === label)).toHaveLength(
			expected_holders(label),
		)
	})

	it('runs each lint shard group as a matrix group', () => {
		expect(GROUP_NAMES).toEqual(expect.arrayContaining(SHARD_GROUP_NAMES))
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

	it.each([
		`${gate_static_group.STATIC_GROUP_FLAG_PREFIX}nope`,
		`${gate_static_group.STATIC_GROUP_FLAG_PREFIX}${LINT_GROUP}`,
		'--verbose',
		FIRST_SHARD_GROUP,
	])('reads no group from %j', (argument) => {
		expect(gate_static_group.group_of(argument)).toBeUndefined()
	})

	it.each(SHARD_GROUP_NAMES)('reads the lint shard group %j from its flag', (name) => {
		expect(gate_static_group.group_of(`${gate_static_group.STATIC_GROUP_FLAG_PREFIX}${name}`)).toBe(
			name,
		)
	})

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

		expect(labels).toEqual([gate_labels.TYPE_CHECK_LABEL, gate_labels.EXPORTS_LABEL])
	})

	it.each(SHARD_GROUPS)('keeps only the lint check on shard %j', (name, shard) => {
		const checks = gate_static_group.narrow_checks(gate_plan.STATIC_CHECKS, name)

		expect(checks.map((check) => check.label)).toEqual([gate_labels.LINT_LABEL])
		expect(lint_shard.shard_of(checks[0]?.args ?? [])).toBe(shard)
	})

	it('finds the group among the other arguments', () => {
		const flag = `${gate_static_group.STATIC_GROUP_FLAG_PREFIX}${FIRST_SHARD_GROUP}`

		expect(gate_static_group.find_group(['--verbose', '--no-unit', flag])).toBe(FIRST_SHARD_GROUP)
	})
})
