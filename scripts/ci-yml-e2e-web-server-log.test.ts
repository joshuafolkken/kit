import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const SANITIZE_VARIABLE = 'WRANGLER_LOG_SANITIZE'
const UPLOAD_CONDITION = 'failure() || cancelled()'
const EXPRESSION_MARKER = '${{'

const {
	upload_input,
	find_upload,
	UPLOAD_NAME_INPUT: NAME_INPUT,
	UPLOAD_PATH_INPUT: PATH_INPUT,
	UPLOAD_MISSING_FILES_INPUT: MISSING_FILES_INPUT,
	UPLOAD_RETENTION_INPUT: RETENTION_INPUT,
	REPORT_ARTIFACT,
	LOG_ARTIFACT,
} = ci_yml_fixture

const e2e_job = ci_yml_fixture.e2e_template_job()
const log_directory = ci_yml_fixture.e2e_log_directory(e2e_job)
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
