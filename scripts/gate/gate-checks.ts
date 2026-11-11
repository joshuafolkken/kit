import { core_weights } from './core-weights'
import { gate_labels } from './gate-labels'

// The gate's check list and which of it one gate runs. How many run at once and how wide the unit
// suite fans out is `gate-plan.ts`'s.

interface GateCheck {
	label: string
	// The `josh` sub-command that defines the check, and the one an appended argument belongs to.
	target: string
	// Arguments the gate always hands the target, before any appended one.
	args?: ReadonlyArray<string>
	// Cores this check holds for as long as it runs — the ratio measured in `gate-plan.ts`, floored to
	// whole cores and never below one. Floored rather than rounded because this is the share the *other*
	// checks must give up: over-reserving costs the elastic check workers it would have used.
	// The unit suite reserves nothing: it sizes its own pool from the machine, so it is capped
	// instead of reserved, and counting it here would reserve cores against itself.
	reserved_cores: number
	// The memory this check holds while it runs, `core_weights.MEMORY_MB`'s measured peak; none declared is
	// none waited for. The unit suite's is per worker, so it is derived instead.
	memory_mb?: number
	// A check whose `josh` command is kit-only, so a consumer's gate leaves it out rather than running
	// a command that is not in the published package. It restates the command
	// entry's own `is_kit_only`, because the command map imports this module;
	// `gate-plan-selection.test.ts` pins that the two agree.
	is_kit_only?: boolean
	// A check that reads the whole repository however small the change (joshuafolkken/kit#7030): a lane's
	// own gate leaves it out, and the ship's gate on the final tree and CI run it.
	is_whole_tree?: boolean
}

// Which of the checks one gate runs. Unset fields are the lane's own local gate: the unit suite in,
// the whole-tree checks out unless the unit suite is elsewhere (CI's shape).
interface CheckSelection {
	is_unit_included?: boolean
	is_kit_repository?: boolean
	is_whole_tree_included?: boolean | undefined
}

const {
	BEHAVIOR_LABEL,
	EXPORTS_LABEL,
	KEEP_WHOLE_SUITE_FLAG,
	LINT_LABEL,
	LOCKFILE_LABEL,
	METRICS_LABEL,
	SPELL_CHECK_LABEL,
	SPELL_CHECK_TARGET,
	TYPE_CHECK_LABEL,
	TYPE_CHECK_TARGET,
	UNIT_LABEL,
	UNIT_TARGET,
} = gate_labels

// The checks that do not fan out across every core, in the order their output is printed. They are
// named apart from the unit suite because CI runs them on their own runner:
// the unit suite is the only check that fans out across every core, so on a 4-core GitHub runner it
// and the others spent the whole job taking cores off each other.
//
// **The behavior check belongs here, and it reserves no core**. It reads one
// recorded transcript rather than the tree, so it is I/O-bound and a zero reservation leaves
// `gate-plan.ts`'s `RESERVED_CORES` and the unit worker cap exactly where the other three were
// measured. Being a static check rather than one appended after the unit suite is what keeps the plan's shape intact: the
// `--no-unit` set stays "the whole gate minus the unit suite", and a CI runner — which has no recorded
// transcripts — runs it as a trivial green rather than skipping it.
//
// **The reserving weights are `core_weights.CORE_WEIGHTS`**, the same numbers the `josh lint`,
// `josh check`, `josh cspell:dot`, `josh exports:unused` and metrics commands claim when run directly.
//
// **The behavior check's zero weight is measured.** A warm run on the 11-core machine took 0.6s of wall
// for 0.7s of CPU, which is node starting up.
//
// **The two whole-tree checks reserve cores** (joshuafolkken/kit#7030). Six lanes ran them on every gate
// at a zero weight, so the core budget's admission never saw them. They now run only where they verify
// the tree that merges — the ship's gate and CI — and reserve what they hold there.
const STATIC_CHECKS: ReadonlyArray<GateCheck> = [
	// **The lint reads the branch's changed files, not the whole tree** (joshuafolkken/kit#4085), and
	// falls back to the whole tree in CI and on a changed configuration (`lint-gate-scope.ts`).
	{
		label: LINT_LABEL,
		target: 'lint',
		args: ['--changed'],
		reserved_cores: core_weights.CORE_WEIGHTS.lint,
		memory_mb: core_weights.MEMORY_MB.lint,
	},
	{
		label: TYPE_CHECK_LABEL,
		target: TYPE_CHECK_TARGET,
		reserved_cores: core_weights.CORE_WEIGHTS.type_check,
		memory_mb: core_weights.MEMORY_MB.type_check,
	},
	{
		label: SPELL_CHECK_LABEL,
		target: SPELL_CHECK_TARGET,
		reserved_cores: core_weights.CORE_WEIGHTS.spell_check,
		memory_mb: core_weights.MEMORY_MB.spell_check,
	},
	{ label: BEHAVIOR_LABEL, target: BEHAVIOR_LABEL, reserved_cores: 0 },
	// **The unused-member check builds one TypeScript program, as the type check does**, and reserves
	// what the type check reserves: measured warm at 5.5s of wall for 9.0s of CPU, 1.6 cores rounded up.
	{
		label: EXPORTS_LABEL,
		target: 'exports:unused',
		reserved_cores: core_weights.CORE_WEIGHTS.type_check,
		is_whole_tree: true,
	},
	// **The metrics ratchet is kit's own**: it holds kit's repository-wide
	// totals to the merge-base's. It is the whole-tree eslint scan with only `max-lines` enabled, so it
	// reserves that scan's weight. It times no startup here: beside the unit suite that reads the load, not josh.
	{
		label: METRICS_LABEL,
		target: METRICS_LABEL,
		args: ['--no-startup'],
		reserved_cores: core_weights.CORE_WEIGHTS.eslint_scan,
		memory_mb: core_weights.MEMORY_MB.metrics,
		is_kit_only: true,
		is_whole_tree: true,
	},
	// The lockfile policy check is network-bound and usually instant: it verifies only when the
	// lockfile or `pnpm-workspace.yaml` moved from the merge-base (joshuafolkken/kit#4090), so it
	// reserves no core. Kit's own until a consumer's private-registry entries are known to verify.
	{ label: LOCKFILE_LABEL, target: 'lockfile:policy', reserved_cores: 0, is_kit_only: true },
]

// The checks, in the order their output is printed — the static set, then the unit suite last (the
// one check that fans out across every core, and the one the `--no-unit` split drops).
//
// **The unit check runs the tests the change can reach, not the whole suite**
// (joshuafolkken/kit#4065): `josh test:related` narrows through the module graph and the test-read
// map, and runs the whole suite — refreshing that map — whenever it cannot tell. The label stays
// `test:unit`, the name every ledger, reservation and record knows the check by. CI runs the whole
// sharded suite regardless, so a lane's gate drops `--keep-whole-suite` (`test-related-whole.ts`).
const GATE_CHECKS: ReadonlyArray<GateCheck> = [
	...STATIC_CHECKS,
	{ label: UNIT_LABEL, target: UNIT_TARGET, args: [KEEP_WHOLE_SUITE_FLAG], reserved_cores: 0 },
]

// **Selecting is not skipping, and the difference is where the unit suite runs rather than whether
// it runs.** `josh gate --no-unit` exists for one caller — the CI job that has handed the unit suite
// to a runner of its own — and every other entry point still gets all four. What makes the narrower
// set safe is that nothing downstream may mistake it for the full gate: `verification-gate.ts`
// withholds both the green-gate record and the in-flight marker on a partial run, so a `--no-unit`
// gate can never tell `josh review:brief` that the unit suite passed on this tree.
//
// A consumer's gate also drops the kit-only checks, whose commands its installed kit does not have.
// The whole-tree checks are in by default only where the unit suite is out: CI's gate has always run
// them, and a lane's local gate leaves them to the ship (joshuafolkken/kit#7030).
function select_gate_checks(
	is_unit_included: boolean,
	is_kit_repository = true,
	is_whole_tree_included = !is_unit_included,
): ReadonlyArray<GateCheck> {
	const checks = is_unit_included ? GATE_CHECKS : STATIC_CHECKS

	return checks.filter(
		(check) =>
			(is_kit_repository || check.is_kit_only !== true) &&
			(is_whole_tree_included || check.is_whole_tree !== true),
	)
}

// What a lane's own `josh gate` runs with no flag: the plan's defaults size this set.
const LANE_GATE_CHECKS: ReadonlyArray<GateCheck> = select_gate_checks(true, true, false)

function selected_checks(selection: CheckSelection): ReadonlyArray<GateCheck> {
	const { is_unit_included = true, is_kit_repository = true, is_whole_tree_included } = selection

	return select_gate_checks(is_unit_included, is_kit_repository, is_whole_tree_included)
}

// The whole-tree checks' labels in this repository, the records a ship's gate must find before it
// reuses a lane gate's green record (`whole-tree-reuse.ts`).
function whole_tree_labels(is_kit_repository = true): ReadonlyArray<string> {
	return select_gate_checks(false, is_kit_repository, true)
		.filter((check) => check.is_whole_tree === true)
		.map((check) => check.label)
}

// Asked of the plan rather than of the flag, so the one question "did this gate run the unit suite"
// has one answer however the plan was built.
function has_unit_check(checks: ReadonlyArray<GateCheck>): boolean {
	return checks.some((check) => check.label === UNIT_LABEL)
}

const gate_checks = {
	GATE_CHECKS,
	LANE_GATE_CHECKS,
	STATIC_CHECKS,
	has_unit_check,
	select_gate_checks,
	selected_checks,
	whole_tree_labels,
}

export type { CheckSelection, GateCheck }
export { gate_checks }
