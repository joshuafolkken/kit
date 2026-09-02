import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'
import { GATE_TARGETS, verification_gate } from './verification-gate'

// joshuafolkken/kit#1216: the `Checks` job ran cspell → prettier → eslint → tsc → vitest one after
// another inside a single job, so 78–162 seconds of a run's wall clock was spent waiting on steps
// that share no state — and it sat on the critical path between the pull request opening and the
// merge. `josh gate` already runs exactly those checks concurrently and reports every failure in
// one pass, so the job runs that instead of restating the five tool invocations.

const CHECKS_JOB = 'checks'
const GATE_STEP = 'pnpm josh gate'
// The five invocations the job used to spell out. Each one is now reached through the `josh`
// sub-command that defines it, so finding any of them here again means the job has gone back to
// verifying a set of its own rather than the one the local gate verifies.
const RESTATED_TOOL_TOKENS: ReadonlyArray<string> = [
	'pnpm exec cspell',
	'pnpm exec prettier',
	'pnpm exec eslint',
	'pnpm exec tsc',
	'pnpm exec vitest',
]

function checks_steps(): ReadonlyArray<WorkflowStep> {
	return ci_yml_fixture.find_job(ci_yml_fixture.RUNTIME_CI_YML, CHECKS_JOB)?.steps ?? []
}

function checks_scripts(): ReadonlyArray<string> {
	return checks_steps().map((step) => ci_yml_fixture.step_run(step))
}

describe('the Checks job runs the verification gate', () => {
	it('runs the gate command', () => {
		expect(checks_scripts().some((script) => script.startsWith(GATE_STEP))).toBe(true)
	})

	// One step, not five run in the background: a job that fanned out in shell would have to reproduce
	// the gate's buffering and its all-failures-in-one-pass summary, which is the clone the rules
	// prohibit and the property the parallelism exists to keep.
	it('runs it as a single step', () => {
		expect(checks_scripts().filter((script) => script.includes(GATE_STEP))).toHaveLength(1)
	})

	// Substring rather than whole-script equality: a reintroduced `pnpm exec eslint .` without the
	// cache flags, or one written inside a `run: |` block, is the same regression and an exact-match
	// guard would let both past.
	it.each(RESTATED_TOOL_TOKENS)('no longer runs %j itself', (fragment) => {
		expect(checks_scripts().some((script) => script.includes(fragment))).toBe(false)
	})

	// The count is what says the suite ran. `josh test:unit` skips rather than fails on a project
	// with no tests — deliberately, and shared with the template — so a quiet green log would look
	// identical whether vitest executed everything or nothing.
	it('prints every check body so the unit count is in the log', () => {
		expect(checks_scripts()).toContain(`${GATE_STEP} ${verification_gate.VERBOSE_FLAG}`)
	})
})

// The parallelism must not be bought by verifying less. The gate's own target list is what says
// which checks it runs, so the coverage claim is read from the code rather than from a comment: a
// check removed from `GATE_TARGETS` fails here rather than quietly leaving CI.
describe('the gate still covers every check the job used to run', () => {
	it.each(['lint', 'check', 'cspell:dot', 'test:unit'])('fans out to %j', (target) => {
		expect(GATE_TARGETS).toContain(target)
	})
})

// The template's checks job is deliberately **not** collapsed: its steps have real ordering
// dependencies — `pnpm prepare` and `svelte-kit sync` before the type check, the build before
// eslint so type-aware linting sees generated output, browsers before the browser-mode unit
// projects, the build before the size check — so running them concurrently would break consumers.
// Pinned so the divergence stays deliberate rather than being read as an oversight and "fixed".
// Scoped to the `checks` job's own step list rather than to offsets in the whole file: the template
// runs `pnpm build` in the e2e job too, so a file-wide `indexOf` could be satisfied by that one and
// hold while the ordering it names was broken.
function template_checks_scripts(): ReadonlyArray<string> {
	const job = ci_yml_fixture.find_job(ci_yml_fixture.TEMPLATE_CI_YML, CHECKS_JOB)

	return (job?.steps ?? []).map((step) => ci_yml_fixture.step_run(step))
}

describe('the distributed template keeps its ordered steps', () => {
	it('still builds before it lints', () => {
		const scripts = template_checks_scripts()
		const build_index = scripts.findIndex((script) => script.startsWith('pnpm build'))
		const eslint_index = scripts.findIndex((script) => script.includes('eslint'))

		expect(build_index).toBeGreaterThan(-1)
		expect(eslint_index).toBeGreaterThan(build_index)
	})

	it('still syncs before it type-checks', () => {
		const scripts = template_checks_scripts()
		const prepare_index = scripts.findIndex((script) => script.startsWith('pnpm prepare'))
		const type_check_index = scripts.findIndex((script) => script.includes('svelte-check'))

		expect(prepare_index).toBeGreaterThan(-1)
		expect(type_check_index).toBeGreaterThan(prepare_index)
	})
})
