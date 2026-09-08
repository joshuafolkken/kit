import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'
import { gate_plan } from './gate-plan'
import { GATE_TARGETS } from './verification-gate'

// joshuafolkken/kit#1226 moved the unit suite off the `Checks` job and onto a runner of its own,
// because it is the only one of the gate's four checks that fans out across every core: on a 4-core
// GitHub runner it and the other three spent the whole job taking cores off each other.
//
// **A job split is only a split while it enforces the same set. Every guard below is about the ways
// it could quietly enforce less**, and there are three, all of them observed in this repository
// before:
//
//   1. A required status check is matched by the check-run *name*, which is a job's `name:`. Two
//      newly named jobs would have left the ruleset's `Checks` context matching nothing, and a
//      context matching nothing is not enforced. So `Checks` stays, on the job that aggregates.
//   2. GitHub counts a **skipped** job as a passing one on the status rollup. An aggregator without
//      `if: always()` inherits "run only if every dependency succeeded" and would therefore *skip*
//      exactly when a half went red — reporting success for the failure it exists to catch. This is
//      how a merge once went through with an E2E suite that never ran (joshuafolkken/kit#991), and
//      the same shape would have reproduced it on the unit suite.
//   3. Calling `vitest` directly rather than `josh test:unit` would give back the half of
//      joshuafolkken/kit#1224 that fails a run which found no test files — a check that ran nothing
//      and reported success.
const RUNTIME = ci_yml_fixture.RUNTIME_CI_YML
const STATIC_JOB = 'static-checks'
const UNIT_JOB = 'unit'
const AGGREGATE_JOB = 'checks'
const NOTIFY_JOB = 'notify-auto-tag'
// The name the branch ruleset's required status check is matched against. It is a repository
// setting, so nothing in this file can read the ruleset itself — what this pins is the half the
// workflow controls: that the name the ruleset was configured with still belongs to a job, and to
// the job that answers for every check.
const REQUIRED_CONTEXT = 'Checks'
const GUARDED_UNIT_COMMAND = 'pnpm josh test:unit'
const ALWAYS = 'always()'

function runtime_job(job_name: string): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(RUNTIME, job_name)
}

function job_scripts(job_name: string): ReadonlyArray<string> {
	return (runtime_job(job_name)?.steps ?? []).map((step) => ci_yml_fixture.step_run(step))
}

function aggregate_step(): WorkflowStep | undefined {
	return runtime_job(AGGREGATE_JOB)?.steps?.[0]
}

function aggregate_script(): string {
	return job_scripts(AGGREGATE_JOB).join('\n')
}

describe('the unit suite has a job of its own', () => {
	it('runs it through the guard that refuses to report a check which ran nothing', () => {
		expect(job_scripts(UNIT_JOB)).toContain(GUARDED_UNIT_COMMAND)
	})

	// The guard is bypassed by calling the runner, not only by removing the step, so the negative is
	// asserted beside the positive — as `scripts/ci-yml-unit-step.test.ts` does for the template.
	it('never reaches vitest directly, which would lose the zero-test failure', () => {
		expect(aggregate_script() + job_scripts(UNIT_JOB).join('\n')).not.toContain('vitest')
	})
})

describe('the aggregate job is what the branch ruleset still requires', () => {
	it('keeps the required context name on a job', () => {
		expect(runtime_job(AGGREGATE_JOB)?.name).toBe(REQUIRED_CONTEXT)
	})

	it('answers for both halves of the gate', () => {
		expect(ci_yml_fixture.job_needs(runtime_job(AGGREGATE_JOB))).toEqual([STATIC_JOB, UNIT_JOB])
	})

	// Without this the job is skipped exactly when a dependency fails, and a skipped check passes.
	it('runs even when a half failed, since a skipped check counts as a passing one', () => {
		expect(runtime_job(AGGREGATE_JOB)?.if?.trim()).toBe(ALWAYS)
	})

	// Read from the step's `env` rather than its script: the results reach the shell as environment
	// variables, because a `${{ }}` expression spliced into a `run:` body is a shape to keep out of a
	// workflow whatever the value's provenance.
	it.each([STATIC_JOB, UNIT_JOB])('reads the result of %s', (job_name) => {
		const declared = Object.values(aggregate_step()?.env ?? {})

		expect(declared).toContain(`\${{ needs.${job_name}.result }}`)
	})

	// `success` is the only `needs.*.result` value that may pass. Asserted as the compared literal so
	// a script rewritten to accept `skipped` — the value that made joshuafolkken/kit#991 a merge
	// rather than a red run — fails here.
	it('accepts no result but success, and exits non-zero otherwise', () => {
		expect(aggregate_script()).toContain("= 'success' ]")
		expect(aggregate_script()).toContain('exit 1')
	})

	it('runs no check itself, so it can never disagree with the halves it reads', () => {
		expect(aggregate_script()).not.toContain('pnpm josh gate')
	})
})

// The point of the whole change: the same checks, on two runners. Read from the gate's own target
// list rather than from the workflow text, so a check dropped from `GATE_CHECKS` fails here instead
// of quietly leaving CI — and so the claim survives a rename of any step.
describe('the split covers every check the single job used to run', () => {
	it('leaves the static checks and the unit suite adjacent, with nothing between them', () => {
		const covered = [...gate_plan.STATIC_CHECKS.map((check) => check.target), gate_plan.UNIT_LABEL]

		expect(covered).toEqual([...GATE_TARGETS])
	})

	it('puts the unit suite outside the gate the static job runs', () => {
		expect(gate_plan.has_unit_check(gate_plan.STATIC_CHECKS)).toBe(false)
		expect(gate_plan.has_unit_check(gate_plan.GATE_CHECKS)).toBe(true)
	})
})

// The auto-tag dispatch gated on `checks` before the split and still does. It reads the aggregate
// rather than the two halves, so a job added to the gate later is covered by it without this
// condition having to be edited again — and, more to the point, without anyone remembering to.
describe('the release dispatch still waits on the whole gate', () => {
	it('gates on the aggregate job', () => {
		expect(ci_yml_fixture.job_needs(runtime_job(NOTIFY_JOB))).toContain(AGGREGATE_JOB)
		expect(runtime_job(NOTIFY_JOB)?.if).toContain(`needs.${AGGREGATE_JOB}.result == 'success'`)
	})
})
