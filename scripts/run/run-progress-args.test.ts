import { describe, expect, it } from 'vitest'
import { run_progress_args } from './run-progress-args'

const HOUR = 3_600_000

describe('the watch bound', () => {
	it('caps an abandoned watcher at one hour by default', () => {
		// The value the bound is pinned to, not just `DEFAULT_MAX_HOURS * HOUR`, which would hold for any
		// default (joshuafolkken/kit#1802): a watcher left on an already-merged run is gone within the hour.
		expect(run_progress_args.DEFAULT_MAX_HOURS).toBe(1)
		expect(run_progress_args.to_max_ms(undefined)).toBe(HOUR)
	})

	it('takes a hand-typed cap, and falls back for one that is not a positive number', () => {
		expect(run_progress_args.to_max_ms('2')).toBe(2 * HOUR)
		expect(run_progress_args.to_max_ms('none')).toBe(run_progress_args.DEFAULT_MAX_HOURS * HOUR)
	})

	// joshuafolkken/kit#3102: `--wait` no longer exits at a report, so its bound is a run's length —
	// an hour would leave one wake an hour that asks the parent for nothing.
	it('caps a `--wait` at eight hours by default, leaving the watch form at one', () => {
		expect(run_progress_args.DEFAULT_WAIT_MAX_HOURS).toBe(8)
		expect(run_progress_args.to_max_ms(undefined, true)).toBe(8 * HOUR)
		expect(run_progress_args.to_max_ms('none', true)).toBe(8 * HOUR)
		expect(run_progress_args.to_max_ms('2', true)).toBe(2 * HOUR)
		expect(run_progress_args.to_max_ms(undefined, false)).toBe(HOUR)
	})
})
