import { gate_labels } from './gate-labels'
import type { GateCheck } from './gate-plan'

// **CI runs the static set as three parallel legs, and each leg is still `josh gate`**
// (joshuafolkken/kit#5215). One runner ran all seven checks for about four minutes while every unit
// shard was done in two, so `static-checks` was the merge's critical path. The legs are a matrix over
// the names below, each running `pnpm josh gate --no-unit --static-group=<name>`, so CI keeps the
// gate's one definition of every check and its all-failures-in-one-pass summary rather than restating
// the commands per job. `gate-static-group.test.ts` pins the partition: every static check is in
// exactly one group, and the workflow's matrix names exactly these groups.
//
// The split follows the weights: lint alone (the cold-cache outlier), the type check with the
// unused-export walk (both build a TypeScript program), and the light rest together.
const STATIC_GROUP_FLAG_PREFIX = '--static-group='

const STATIC_GROUPS: Readonly<Record<string, ReadonlyArray<string>>> = {
	lint: [gate_labels.LINT_LABEL],
	types: [gate_labels.TYPE_CHECK_LABEL, gate_labels.EXPORTS_LABEL],
	rest: [
		gate_labels.SPELL_CHECK_LABEL,
		gate_labels.BEHAVIOR_LABEL,
		gate_labels.METRICS_LABEL,
		gate_labels.LOCKFILE_LABEL,
	],
}

// The group an argument names, or `undefined` when it is not the flag or names no group — so an
// unknown group is refused with every other unknown argument.
function group_of(argument: string): string | undefined {
	if (!argument.startsWith(STATIC_GROUP_FLAG_PREFIX)) return undefined

	const name = argument.slice(STATIC_GROUP_FLAG_PREFIX.length)

	return Object.hasOwn(STATIC_GROUPS, name) ? name : undefined
}

function find_group(arguments_: ReadonlyArray<string>): string | undefined {
	return arguments_.map((argument) => group_of(argument)).find((name) => name !== undefined)
}

function narrow_checks(
	checks: ReadonlyArray<GateCheck>,
	group: string | undefined,
): ReadonlyArray<GateCheck> {
	if (group === undefined) return checks

	const labels = STATIC_GROUPS[group] ?? []

	return checks.filter((check) => labels.includes(check.label))
}

const gate_static_group = {
	STATIC_GROUPS,
	STATIC_GROUP_FLAG_PREFIX,
	find_group,
	group_of,
	narrow_checks,
}

export { gate_static_group }
