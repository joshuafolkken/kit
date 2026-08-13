import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'

const ATTEMPT_SUFFIX = '-attempt-1'
const TEST_COMMAND = 'pnpm exec playwright test'
const WARNING_ANNOTATION = '::warning::'
const FIRST_ATTEMPT_ID = 'e2e_tests'
const RETRY_FLAG = 'E2E_RETRY_ENABLED'
const RETRY_ENABLED = `env.${RETRY_FLAG} == 'true'`
const FIRST_ATTEMPT_FAILED = `steps.${FIRST_ATTEMPT_ID}.outcome == 'failure'`
// Every step between the two attempts shares this condition. !cancelled() rather than the implicit
// success(): a bare outcome check is ANDed with success(), so a hiccup in one of these steps would
// skip the rest — including the retry, withholding the release over the diagnostics — while a run
// superseded by the concurrency group must not start a second suite. The flag keeps a pull request
// out of the chain, so nothing is renamed there and its single attempt's report is what ships.
const AFTER_FAILURE_CONDITION = `\${{ !cancelled() && ${RETRY_ENABLED} && ${FIRST_ATTEMPT_FAILED} }}`
const DEFAULT_BRANCH_PUSH = "github.event_name == 'push' && github.ref == 'refs/heads/main'"
const {
	upload_input,
	find_upload,
	UPLOAD_NAME_INPUT: NAME_INPUT,
	UPLOAD_PATH_INPUT: PATH_INPUT,
	UPLOAD_MISSING_FILES_INPUT: MISSING_FILES_INPUT,
	UPLOAD_RETENTION_INPUT: RETENTION_INPUT,
	LOG_PATH_VARIABLE,
	REPORT_ARTIFACT,
	LOG_ARTIFACT,
} = ci_yml_fixture
// The pair every first-attempt guard iterates: naming it once keeps a guard from being written
// against one artifact while the other quietly goes unchecked.
const ATTEMPT_ARTIFACTS = [REPORT_ARTIFACT, LOG_ARTIFACT]

// Setup, two attempts and the upload of the first attempt's evidence all have to fit the job
// budget, and the retried step rebuilds the app before serving it, so the repeated portion is the
// whole E2E step rather than the specs alone. A second attempt killed by the timeout ends the job
// as `cancelled`: the release is withheld just as the crash would have withheld it, and the
// uploads that would explain the run are truncated.
const MIN_RETRY_TIMEOUT_MINUTES = 25

const e2e_job = ci_yml_fixture.e2e_template_job()
const steps = e2e_job?.steps ?? []
const log_directory = ci_yml_fixture.e2e_log_directory(e2e_job)

function step_index(is_match: (step: WorkflowStep) => boolean): number {
	return steps.findIndex((step) => is_match(step))
}

function find_attempt_upload(artifact: string): WorkflowStep | undefined {
	return find_upload(e2e_job, `${artifact}${ATTEMPT_SUFFIX}`)
}

const first_attempt = steps.find((step) => step.id === FIRST_ATTEMPT_ID)
const run_steps = steps.filter((step) => step.run === TEST_COMMAND)
const retry_step = run_steps.find((step) => step.id !== FIRST_ATTEMPT_ID)
const preserve_index = step_index((step) => (step.run ?? '').includes(ATTEMPT_SUFFIX))
const preserve_step = steps[preserve_index]
const retry_index = step_index((step) => step === retry_step)
// Everything in the after-failure chain except the retry itself is there to save evidence, so the
// group is derived from the shared condition rather than listed by step name: a step added to the
// chain later joins it the day it is written and cannot omit the guard below unnoticed.
const evidence_steps = steps.filter(
	(step) => step.if === AFTER_FAILURE_CONDITION && step !== retry_step,
)

// Only the distributed template is asserted on: kit's own e2e job never runs (no E2E specs), so
// this wiring exists for consumers alone — the same split as the web server log guard for #781.
describe('ci.yml e2e retry (templates/workflows/ci.yml)', () => {
	// Regression guard for #783: a transient crash on the default branch skipped the auto-tag
	// dispatch, so the merged version was never tagged and never deployed until someone re-ran
	// the job by hand. The release must survive one failed attempt.
	it('runs the suite at most twice — one first attempt and a single retry', () => {
		expect(run_steps).toHaveLength(2)
		expect(retry_step).toBeDefined()
	})

	it('starts the retry only when the first attempt failed, so a green run pays nothing', () => {
		expect(retry_step?.if).toBe(AFTER_FAILURE_CONDITION)
	})

	// continue-on-error must stay an expression: a literal `true` would swallow a pull request
	// failure too, and the retry step would then never be reached to fail the job.
	it('lets only a run allowed to retry continue past the first failure', () => {
		expect(ci_yml_fixture.step_continue_on_error(first_attempt)).toBe(`\${{ ${RETRY_ENABLED} }}`)
	})

	// The branch rule lives in one place: a copy in each step condition could permit a failure to
	// be survived on a run that then never retries, which is the withheld release all over again.
	it('derives the retry permission from a default-branch push, declared once', () => {
		expect(e2e_job?.env?.[RETRY_FLAG]).toBe(`\${{ ${DEFAULT_BRANCH_PUSH} }}`)
	})

	it('leaves the retry free to fail the job for a genuinely broken suite', () => {
		expect(ci_yml_fixture.step_continue_on_error(retry_step)).toBeUndefined()
	})

	it('retries with the same command rather than a narrowed rerun', () => {
		expect(retry_step?.run).toBe(first_attempt?.run)
	})
})

// The retry overwrites playwright-report/ and the web server log directory, so the first attempt
// leaves no trace unless it is moved aside first. Without this a green retry would erase the only
// record of the crash — the reason #783 was blocked on #781.
describe('ci.yml e2e retry preserves the first attempt (templates/workflows/ci.yml)', () => {
	it('moves the first attempt output aside before the retry starts', () => {
		expect(preserve_index).toBeGreaterThanOrEqual(0)
		expect(preserve_index).toBeLessThan(retry_index)
	})

	// The rename must be gated exactly like the retry that follows it. A step left out of the
	// chain would let a pull request run keep its directories in place while the retry renamed
	// them anyway — publishing the retry's output under the primary artifact names.
	it('renames under the same condition as the retry it prepares for', () => {
		expect(preserve_step?.if).toBe(AFTER_FAILURE_CONDITION)
	})

	it('derives the log directory from the env var instead of repeating its name', () => {
		expect(preserve_step?.run).toContain(LOG_PATH_VARIABLE)
	})

	// Saving the evidence must never be what withholds the release: a move that fails is announced
	// and the run continues, rather than failing the job before the retry that fixes it.
	it('announces a failed move instead of failing the job over the diagnostics', () => {
		expect(preserve_step?.run).toContain('! mv')
		expect(preserve_step?.run).toContain(WARNING_ANNOTATION)
	})

	// A retry that passes leaves a green job, so without an annotation a half-flaky test would
	// ship release after release with nothing on the run to read. The notice has to say where to
	// look, but naming one artifact would make it a lie whenever that attempt wrote no report.
	it('annotates the swallowed failure and points at the preserved output', () => {
		const [notice] = (preserve_step?.run ?? '').split('\n\n', 1)

		expect(notice).toContain(WARNING_ANNOTATION)
		expect(notice).toContain(ATTEMPT_SUFFIX)
		expect(notice).not.toContain(`${REPORT_ARTIFACT}${ATTEMPT_SUFFIX}`)
	})

	it('uploads both first attempt artifacts before the retry overwrites them', () => {
		for (const artifact of ATTEMPT_ARTIFACTS) {
			const index = step_index((step) => step.with?.[NAME_INPUT] === `${artifact}${ATTEMPT_SUFFIX}`)

			expect(index).toBeGreaterThan(preserve_index)
			expect(index).toBeLessThan(retry_index)
		}
	})
})

// The invariant the whole after-failure chain is written around, asserted on the group rather than
// on the steps that happen to be in it today (#789). Every one of them saves evidence, and saving
// evidence must not be what decides the release: a write error in the rename's annotations, or a
// transient artifact-service error in either upload, would end the job red even after the retry
// passed — withholding the tag exactly as the crash did.
describe('ci.yml e2e evidence collection (templates/workflows/ci.yml)', () => {
	it('never lets collecting the first attempt evidence withhold the release', () => {
		// Guards the filter as much as the workflow: a drifted condition string would leave the
		// group empty, and the loop below would then pass while asserting nothing.
		const known_members = [
			preserve_step,
			...ATTEMPT_ARTIFACTS.map((artifact) => find_attempt_upload(artifact)),
		]

		expect(evidence_steps).toEqual(expect.arrayContaining(known_members))

		for (const step of evidence_steps) {
			expect(ci_yml_fixture.step_continue_on_error(step)).toBe(true)
		}
	})
})

describe('ci.yml e2e first attempt artifacts (templates/workflows/ci.yml)', () => {
	it('attributes each first attempt artifact to that attempt by name and path', () => {
		expect(upload_input(find_attempt_upload(REPORT_ARTIFACT), PATH_INPUT)).toBe(
			`${REPORT_ARTIFACT}${ATTEMPT_SUFFIX}/`,
		)
		expect(upload_input(find_attempt_upload(LOG_ARTIFACT), PATH_INPUT)).toBe(
			`${log_directory.replace(/\/$/u, '')}${ATTEMPT_SUFFIX}/`,
		)
	})

	it('uploads the first attempt only when there was one, and tolerates a missing log', () => {
		for (const artifact of ATTEMPT_ARTIFACTS) {
			const step = find_attempt_upload(artifact)

			expect(step?.if).toBe(AFTER_FAILURE_CONDITION)
			expect(upload_input(step, MISSING_FILES_INPUT)).toBe('ignore')
			expect(upload_input(step, RETENTION_INPUT)).toBe(
				upload_input(find_upload(e2e_job, artifact), RETENTION_INPUT),
			)
		}
	})
})

describe('ci.yml e2e retry job shape (templates/workflows/ci.yml)', () => {
	it('keeps the final upload steps after the retry so they capture its output', () => {
		// Without this the comparison below is satisfied by a missing retry step (index -1), and
		// the ordering guard would keep passing on a workflow that has no retry at all.
		expect(retry_index).toBeGreaterThanOrEqual(0)

		for (const artifact of ATTEMPT_ARTIFACTS) {
			expect(step_index((step) => step.with?.[NAME_INPUT] === artifact)).toBeGreaterThan(
				retry_index,
			)
		}
	})

	it('budgets job time for two attempts so a real failure ends as failure, not cancelled', () => {
		expect(ci_yml_fixture.job_timeout_minutes(e2e_job)).toBeGreaterThanOrEqual(
			MIN_RETRY_TIMEOUT_MINUTES,
		)
	})
})
