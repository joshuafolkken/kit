import { CODE_RABBIT, make_pr_snapshot, SONAR_QUBE } from '#scripts/gh/git-pr-checks-fixture'
import { describe, expect, it } from 'vitest'
import { followup_check_report } from './followup-check-report'

// joshuafolkken/kit#5545: `followup` drafts the completion notification's check report itself, one
// line per check, instead of the model retyping it into `--notify-message`.

const WORKERS_BUILDS = 'Workers Builds'
const REQUIRED_E2E = 'E2E'
const RERUN_JOB = 'Detect E2E'

const QUIET = { snapshot: make_pr_snapshot(), reran: [], is_retriggered: false }

describe('followup_check_report.lines — failed checks', () => {
	it('writes one line per failed check and tells required from not required', () => {
		const snapshot = make_pr_snapshot({
			rollup: [
				{ name: SONAR_QUBE, status: 'pass' },
				{ name: WORKERS_BUILDS, status: 'fail' },
				{ name: REQUIRED_E2E, status: 'fail' },
			],
			required_contexts: [REQUIRED_E2E],
		})

		expect(followup_check_report.lines({ ...QUIET, snapshot })).toStrictEqual([
			'Checks:',
			`- ${WORKERS_BUILDS} — failed (not required)`,
			`- ${REQUIRED_E2E} — failed (required)`,
		])
	})

	it('reports nothing for a snapshot it never received', () => {
		expect(followup_check_report.lines({ ...QUIET, snapshot: undefined })).toStrictEqual([])
	})
})

describe('followup_check_report.lines — reruns and retriggers', () => {
	it('lists a rerun job and the CodeRabbit retrigger beside a failed check', () => {
		const snapshot = make_pr_snapshot({
			rollup: [{ name: CODE_RABBIT, status: 'fail' }],
		})

		expect(
			followup_check_report.lines({ snapshot, reran: [RERUN_JOB], is_retriggered: true }),
		).toStrictEqual([
			'Checks:',
			`- ${CODE_RABBIT} — failed (not required)`,
			`- ${RERUN_JOB} — re-run once, judged flaky; green on the re-run`,
			`- ${CODE_RABBIT} — rate limited; review retriggered`,
		])
	})

	it('reports a job rerun in two waits once', () => {
		expect(followup_check_report.lines({ ...QUIET, reran: [RERUN_JOB, RERUN_JOB] })).toStrictEqual([
			'Checks:',
			`- ${RERUN_JOB} — re-run once, judged flaky; green on the re-run`,
		])
	})

	it('answers no line at all, header included, on a run with nothing to report', () => {
		expect(followup_check_report.lines(QUIET)).toStrictEqual([])
	})
})
