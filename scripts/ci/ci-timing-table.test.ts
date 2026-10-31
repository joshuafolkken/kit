import { describe, expect, it } from 'vitest'
import { ci_timing_table } from './ci-timing-table'

// The jobs endpoint's answer as REST sends it, `null` for what has not started or finished.
const JOBS_PAGE: unknown = JSON.parse(`{
	"total_count": 2,
	"jobs": [
		{
			"id": 1, "name": "unit", "conclusion": "success",
			"started_at": "2026-10-31T00:00:00Z", "completed_at": "2026-10-31T00:02:05Z",
			"steps": [
				{
					"name": "Set up job", "conclusion": "success",
					"started_at": "2026-10-31T00:00:00Z", "completed_at": "2026-10-31T00:00:02Z"
				},
				{
					"name": "Run tests", "conclusion": "failure",
					"started_at": "2026-10-31T00:00:02Z", "completed_at": "2026-10-31T00:02:05Z"
				},
				{ "name": "Post", "conclusion": "skipped", "started_at": null, "completed_at": null }
			]
		},
		{
			"id": 2, "name": "e2e", "conclusion": null,
			"started_at": "2026-10-31T00:00:00Z", "completed_at": null
		}
	]
}`)

describe('ci_timing_table.jobs_of', () => {
	it('builds one row per job and step with seconds and conclusion', () => {
		const [unit, e2e] = ci_timing_table.jobs_of(JOBS_PAGE)

		expect(unit).toStrictEqual({
			name: 'unit',
			seconds: 125,
			conclusion: 'success',
			steps: [
				{ name: 'Set up job', seconds: 2, conclusion: 'success' },
				{ name: 'Run tests', seconds: 123, conclusion: 'failure' },
				{ name: 'Post', seconds: undefined, conclusion: 'skipped' },
			],
		})
		expect(e2e).toStrictEqual({ name: 'e2e', seconds: undefined, conclusion: undefined, steps: [] })
	})

	it('refuses an answer that is not a jobs page', () => {
		expect(() => ci_timing_table.jobs_of({ message: 'Not Found' })).toThrow()
	})
})

describe('ci_timing_table.table', () => {
	it('prints a header, each job and its indented steps with right-aligned seconds', () => {
		const text = ci_timing_table.table(ci_timing_table.jobs_of(JOBS_PAGE))

		expect(text.split('\n')).toStrictEqual([
			'job / step      s  conclusion',
			'unit          125  success',
			'  Set up job    2  success',
			'  Run tests   123  failure',
			'  Post          —  skipped',
			'e2e             —  —',
		])
	})
})
