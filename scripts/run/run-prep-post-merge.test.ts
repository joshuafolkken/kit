import { describe, expect, it } from 'vitest'
import { run_prep, type PrepParts } from './run-prep'

// joshuafolkken/kit#8502: the completion gate (`/verify-ui`) reads the post-merge check off the
// state section's `post_merge_check:` line, beside `human_review:`.
const PARTS: PrepParts = {
	issue_number: '8502',
	content_body: 'issue: 8502',
	state: undefined,
	state_failure: 'state: unavailable',
	latest_scope: 'skip',
	latest_reason: 'not asked',
	has_changes: false,
	locations: '',
	ship_problems: [],
}

describe('run_prep.format_report — post_merge_check', () => {
	it('prints the answer line right after the state lines', () => {
		const report = run_prep.format_report({ ...PARTS, post_merge_check: 'post_merge_check: none' })

		expect(report).toContain(`${run_prep.STATE_HEADER}\nstate: unavailable\npost_merge_check: none`)
	})

	it('prints an unknown answer when the body read failed', () => {
		expect(run_prep.format_report(PARTS)).toContain('\npost_merge_check: ?')
	})
})
