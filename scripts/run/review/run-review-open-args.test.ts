import { describe, expect, it } from 'vitest'
import { run_review_open_args } from './run-review-open-args'

// joshuafolkken/kit#7599: run:review's open reads `--unpinned-ok` and `--accept-metrics`.

const REASON = 'a new command'
const ACCEPT = run_review_open_args.ACCEPT_METRICS_FLAG
const UNPINNED = '--unpinned-ok'

describe('run_review_open_args.parse', () => {
	it('answers no reasons for an empty argv', () => {
		expect(run_review_open_args.parse([])).toStrictEqual({
			unpinned_ok: undefined,
			accept_metrics: undefined,
		})
	})

	it('reads --accept-metrics alone', () => {
		expect(run_review_open_args.parse([ACCEPT, REASON])).toStrictEqual({
			unpinned_ok: undefined,
			accept_metrics: REASON,
		})
	})

	it('reads both reasons together', () => {
		expect(run_review_open_args.parse([UNPINNED, 'only logs', ACCEPT, REASON])).toStrictEqual({
			unpinned_ok: 'only logs',
			accept_metrics: REASON,
		})
	})

	it.each([[[ACCEPT, '  ']], [[UNPINNED, '']], [[ACCEPT]], [['--nope']], [['extra']]])(
		'refuses %j',
		(argv) => {
			expect(run_review_open_args.parse(argv)).toBeUndefined()
		},
	)
})
