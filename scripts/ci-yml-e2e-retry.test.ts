import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'
import { LOG_PATH_VARIABLE as CHECK_LOG_VARIABLE, DEFAULT_LOG_DIRECTORY } from './e2e-retry-check'

const TEST_COMMAND = 'pnpm exec playwright test'
const WARNING_ANNOTATION = '::warning::'
const FIRST_ATTEMPT_ID = 'e2e_tests'
const RETRY_FLAG = 'E2E_RETRY_ENABLED'
const UNCONDITIONAL_FLAG = 'E2E_RETRY_UNCONDITIONAL'
const RETRY_ENABLED = `env.${RETRY_FLAG} == 'true'`
const FIRST_ATTEMPT_FAILED = `steps.${FIRST_ATTEMPT_ID}.outcome == 'failure'`
const CHECK_ID = 'e2e_retry_check'
const RETRY_ID = 'e2e_retry'
const UNCONDITIONAL = `env.${UNCONDITIONAL_FLAG} == 'true'`
const CRASHED = `steps.${CHECK_ID}.outputs.crashed == 'true'`
// The correction that keeps #783 intact. The flag is read here, in the workflow, rather than passed
// down to the check command — a step carrying continue-on-error publishes no output when it errors,
// so a default-branch rule that depended on this command succeeding would lose the retry it must
// never lose. As an OR, an unreadable log costs a pull request its retry and the default branch
// nothing.
const RETRY_DECIDED = `(${UNCONDITIONAL} || ${CRASHED})`
const CHECK_COMMAND = 'pnpm josh e2e:retry-check'
// The condition the crash check runs under: the first attempt failed on a run allowed to survive
// it. This is deliberately one term short of the chain below — the check is what produces the term
// the rest branch on, so it cannot wait for it.
const AFTER_FAILURE_CONDITION = `\${{ !cancelled() && ${RETRY_ENABLED} && ${FIRST_ATTEMPT_FAILED} }}`
// Every step between the two attempts shares this condition. !cancelled() rather than the implicit
// success(): a bare outcome check is ANDed with success(), so a hiccup in one of these steps would
// skip the rest — including the retry, withholding the release over the diagnostics — while a run
// superseded by the concurrency group must not start a second suite. The decision term keeps a
// pull request whose suite simply failed out of the chain, so nothing is renamed there and its
// single attempt's report is what ships (#872).
const RETRY_CONDITION = `\${{ !cancelled() && ${RETRY_ENABLED} && ${FIRST_ATTEMPT_FAILED} && ${RETRY_DECIDED} }}`
const DEFAULT_BRANCH_PUSH = "github.event_name == 'push' && github.ref == 'refs/heads/main'"
const PULL_REQUEST = "github.event_name == 'pull_request'"
const {
	ATTEMPT_SUFFIX,
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
const evidence_steps = steps.filter((step) => step.if === RETRY_CONDITION && step !== retry_step)

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
		expect(retry_step?.if).toBe(RETRY_CONDITION)
	})

	// The flag is the OR of the workflow's only two triggers, so today this expression is constantly
	// true and a literal `true` would behave identically — which is exactly why the guard is worth
	// keeping rather than simplifying away. What stops a swallowed pull request failure from
	// shipping green is now the gate step below, not this term; the term is what keeps the job
	// correct the day a third trigger (a schedule, a manual dispatch) is added and must not survive
	// its first failure at all.
	it('derives continue-on-error from the flag rather than hard-coding it', () => {
		expect(ci_yml_fixture.step_continue_on_error(first_attempt)).toBe(`\${{ ${RETRY_ENABLED} }}`)
	})

	// The branch rules live in one place each: a copy in a step condition could permit a failure to
	// be survived on a run that then never retries, which is the withheld release all over again.
	// The two flags are separate because they answer different questions — may this run survive its
	// first failure, and may it retry without a reason — and collapsing them back into one is what
	// would either withhold a release or retry a pull request's failing suite until it passed.
	it('lets a default-branch push and a pull request both survive the first failure', () => {
		const declared = e2e_job?.env?.[RETRY_FLAG] ?? ''

		expect(declared).toContain(DEFAULT_BRANCH_PUSH)
		expect(declared).toContain(PULL_REQUEST)
	})

	it('grants the reason-free retry to a default-branch push alone', () => {
		const declared = e2e_job?.env?.[UNCONDITIONAL_FLAG] ?? ''

		expect(declared).toContain(DEFAULT_BRANCH_PUSH)
		expect(declared).not.toContain(PULL_REQUEST)
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
		expect(preserve_step?.if).toBe(RETRY_CONDITION)
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

			expect(step?.if).toBe(RETRY_CONDITION)
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

// #872. A pull request used to leave the chain before it started: its first attempt failed, the
// job went red, and a human pressed re-run — over and over, because the preview server process
// dying is a property of the CI substrate rather than of the diff under review. These guards are
// what keep the narrower gate that replaced it honest in both directions.
describe('ci.yml e2e crash check (templates/workflows/ci.yml)', () => {
	const check_step = steps.find((step) => step.id === CHECK_ID)
	const check_index = step_index((step) => step.id === CHECK_ID)

	// The decision has to exist before anything branches on it, and the rename in particular: a
	// check placed after it would publish the retry's output under the first attempt's names.
	it('decides before the first attempt output is touched', () => {
		expect(check_index).toBeGreaterThan(step_index((step) => step.id === FIRST_ATTEMPT_ID))
		expect(check_index).toBeLessThan(preserve_index)
	})

	// One term short of the chain it feeds, and necessarily so — this step produces that term.
	it('runs whenever a run allowed to survive its first failure had one', () => {
		expect(check_step?.if).toBe(AFTER_FAILURE_CONDITION)
	})

	// The rule that tells a crash from a failing suite is the one part of this chain that can be
	// wrong without anyone noticing, so it lives in a unit-tested script rather than in shell here.
	it('reads the verdict from the tested command instead of shell in this file', () => {
		expect(check_step?.run).toBe(CHECK_COMMAND)
	})

	// #783's regression guard, at the exact shape that would reintroduce it: the check carries
	// continue-on-error, so a default-branch retry conditioned on its output alone would be skipped
	// whenever it errored — and the gate below would then fail the job and withhold the release,
	// which is precisely the outcome the unconditional retry was added to prevent.
	it('retries the default branch on the flag alone, whatever this step managed to publish', () => {
		expect(retry_step?.if).toContain(UNCONDITIONAL)
		expect(ci_yml_fixture.step_continue_on_error(check_step)).toBe(true)
	})

	// A check that cannot read the log must not be what fails the job: it publishes no output, the
	// chain does not retry, and the gate below reports the original failure. Failing here instead
	// would withhold a release over a diagnostic.
	it('never lets an unreadable log be what fails the job', () => {
		expect(ci_yml_fixture.step_continue_on_error(check_step)).toBe(true)
	})

	// The command and the job have to name one directory. A rename on either side alone would leave
	// the check reading an empty directory and deciding "no crash" on every run — a pull request
	// silently back to its old behavior, with nothing red to say so.
	it('reads the directory the job actually writes the log to', () => {
		expect(CHECK_LOG_VARIABLE).toBe(LOG_PATH_VARIABLE)
		expect(log_directory.replace(/\/$/u, '')).toBe(DEFAULT_LOG_DIRECTORY)
	})
})

// The hazard this change introduces, guarded at its exact shape: a pull request now survives its
// first failure, so if no retry follows, nothing else in the job is red and a genuinely failing
// suite would ship as a green check.
describe('ci.yml e2e unretried failure gate (templates/workflows/ci.yml)', () => {
	const gate_condition = `\${{ !cancelled() && ${FIRST_ATTEMPT_FAILED} && steps.${RETRY_ID}.outcome == 'skipped' }}`
	const gate_step = steps.find((step) => step.if === gate_condition)

	it('fails the job when the first attempt failed and no retry followed', () => {
		expect(gate_step).toBeDefined()
		expect(gate_step?.run).toContain('exit 1')
	})

	// Keyed to the retry having been skipped, not to the event name: a failing suite, a log with no
	// signature, a consumer that writes no log, and a check step that errored all arrive by this one
	// path, and all four must be red. Naming the event to excuse the default branch would, on any
	// future path that skipped the retry there, let a swallowed failure ship green with the release.
	it('reads the skipped retry rather than re-deriving which event this is', () => {
		expect(gate_step?.if).not.toContain('github.event_name')
		expect(steps.find((step) => step === retry_step)?.id).toBe(RETRY_ID)
	})

	it('runs after the retry it reports on', () => {
		expect(step_index((step) => step === gate_step)).toBeGreaterThan(retry_index)
	})

	// Without a guard the job could not go red at all: continue-on-error here would swallow the very
	// failure the step exists to re-raise.
	it('is free to fail the job', () => {
		expect(ci_yml_fixture.step_continue_on_error(gate_step)).toBeUndefined()
	})
})
