// **The gate's check names, in a module that imports nothing** (joshuafolkken/kit#5177). Most readers of
// `gate-plan.ts` wanted only these strings, and importing the plan for them tied every such reader into
// the plan's own imports — so a change to the plan reached most of the test suite. The plan builds its
// checks from these; a reader that needs only a name imports this leaf.

const LINT_LABEL = 'lint'
const TYPE_CHECK_LABEL = 'check'
// The `josh` command the gate's type check runs, shared with `check:related` so the scoped check runs the same one.
const TYPE_CHECK_TARGET = 'check'
const SPELL_CHECK_LABEL = 'cspell'
const SPELL_CHECK_TARGET = 'cspell:dot'
const UNIT_LABEL = 'test:unit'
const UNIT_TARGET = 'test:related'
// **The gate's unit leg runs the whole suite for a changed file every test imports**
// (joshuafolkken/kit#5122), which every other `josh test:related` narrows to its direct importers.
const KEEP_WHOLE_SUITE_FLAG = '--keep-whole-suite'
const BEHAVIOR_LABEL = 'behavior'
const METRICS_LABEL = 'metrics'
const EXPORTS_LABEL = 'exports'
const LOCKFILE_LABEL = 'lockfile'

// The checks whose warnings must survive the green record: eslint (the `lint` step) and svelte-check
// (the `check` step) both exit 0 while reporting per-tree warnings a developer needs to see again, so
// reusing a record taken from such a run would hide them. Every other step's
// warning-shaped output — a Vite config deprecation printed by `test:unit`, say — is not a per-tree
// finding and repeats every run, so it must not withhold the record. `has_checker_warning` narrows
// the withholding path down to these.
const WARNING_CHECKER_LABELS: ReadonlyArray<string> = [LINT_LABEL, TYPE_CHECK_LABEL]

const gate_labels = {
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
	WARNING_CHECKER_LABELS,
}

export { gate_labels }
