import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'

const E2E_JOB = 'e2e'
const LOG_PATH_VARIABLE = 'WRANGLER_LOG_PATH'
const SANITIZE_VARIABLE = 'WRANGLER_LOG_SANITIZE'
const UPLOAD_CONDITION = 'failure() || cancelled()'
const EXPRESSION_MARKER = '${{'
const REPORT_ARTIFACT = 'playwright-report'
const LOG_ARTIFACT = 'e2e-web-server-log'

const NAME_INPUT = 'name'
const PATH_INPUT = 'path'
const MISSING_FILES_INPUT = 'if-no-files-found'
const RETENTION_INPUT = 'retention-days'

function upload_input(step: WorkflowStep | undefined, key: string): string | number | undefined {
	return step?.with?.[key]
}

function find_upload(job: WorkflowJob | undefined, artifact: string): WorkflowStep | undefined {
	return job?.steps?.find((step) => upload_input(step, NAME_INPUT) === artifact)
}

const e2e_job = ci_yml_fixture.find_job(ci_yml_fixture.TEMPLATE_CI_YML, E2E_JOB)
const log_directory = e2e_job?.env?.[LOG_PATH_VARIABLE] ?? ''
const upload_step = find_upload(e2e_job, LOG_ARTIFACT)
const report_step = find_upload(e2e_job, REPORT_ARTIFACT)

// Only the distributed template is asserted on: kit's own runtime workflow has no preview
// server and its e2e job never runs, so this wiring exists for consumers alone.
describe('ci.yml e2e web server log (templates/workflows/ci.yml)', () => {
	// A container job mounts the workspace elsewhere than ${{ github.workspace }} reports, so an
	// absolute or templated path would send wrangler somewhere the upload step cannot reach.
	it('redirects the web server log into the workspace instead of the discarded home dir', () => {
		expect(log_directory).not.toBe('')
		expect(log_directory.startsWith('/')).toBe(false)
		expect(log_directory).not.toContain(EXPRESSION_MARKER)
		expect(log_directory.endsWith('/')).toBe(true)
	})

	it('uploads exactly the directory the web server was told to write to', () => {
		expect(upload_input(upload_step, PATH_INPUT)).toBe(log_directory)
	})

	it('collects the log when the job fails or is cancelled by its own timeout', () => {
		expect(upload_step?.if).toBe(UPLOAD_CONDITION)
	})

	it('tolerates a preview script that is not wrangler and writes no log at all', () => {
		expect(upload_input(upload_step, MISSING_FILES_INPUT)).toBe('ignore')
	})

	it('keeps the artifact separate from the test report and matches its retention', () => {
		expect(report_step).toBeDefined()
		expect(upload_input(upload_step, NAME_INPUT)).not.toBe(upload_input(report_step, NAME_INPUT))
		expect(upload_input(upload_step, RETENTION_INPUT)).toBe(
			upload_input(report_step, RETENTION_INPUT),
		)
	})

	it('pins log sanitization on so tokens never reach the artifact', () => {
		expect(e2e_job?.env?.[SANITIZE_VARIABLE]).toBe('true')
	})
})
