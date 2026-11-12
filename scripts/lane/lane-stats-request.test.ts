import { describe, expect, it } from 'vitest'
import { lane_stats_request } from './lane-stats-request'

const SINCE = '2026-11-10T08:00+07:00'

// The `josh lane:stats` flags read into one request, `--pairs` among the tables (joshuafolkken/kit#6189).

describe('lane_stats_request.stats_request', () => {
	it('reads the period alone as the period row and tables', () => {
		expect(lane_stats_request.stats_request(['--period', '7'])).toStrictEqual({
			start: { period_days: 7 },
			limit: undefined,
			sinks: undefined,
			over: undefined,
			why: undefined,
			is_pairs: false,
		})
	})

	it('reads --pairs as the pairs table', () => {
		expect(lane_stats_request.stats_request(['--period', '1', '--pairs'])?.is_pairs).toBe(true)
	})

	it('reads --why as the cause table with a positive threshold', () => {
		expect(lane_stats_request.stats_request(['--period', '1', '--why', '40'])?.why).toBe(40)
	})
})

describe('lane_stats_request.stats_request — why refusals', () => {
	it.each([['--limit', '4'], ['--sinks'], ['--over', '40'], ['--pairs'], ['9']])(
		'refuses --why beside %s',
		(...flags) => {
			expect(
				lane_stats_request.stats_request(['--period', '1', '--why', '40', ...flags]),
			).toBeUndefined()
		},
	)

	it.each(['0', '-1', 'Infinity', 'soon'])('refuses --why %s', (minutes) => {
		expect(lane_stats_request.stats_request(['--period', '1', '--why', minutes])).toBeUndefined()
	})
})

describe('lane_stats_request.stats_request — other tables', () => {
	it.each([['--limit', '4'], ['--sinks'], ['--over', '40']])(
		'refuses --pairs beside %s',
		(...flags) => {
			expect(
				lane_stats_request.stats_request(['--period', '1', '--pairs', ...flags]),
			).toBeUndefined()
		},
	)

	it('reads the --sinks threshold and refuses a positional without it', () => {
		expect(lane_stats_request.stats_request(['--period', '1', '--sinks', '45'])?.sinks).toBe(45)
		expect(lane_stats_request.stats_request(['--period', '1', '45'])).toBeUndefined()
	})

	it('refuses a period that is not positive', () => {
		expect(lane_stats_request.stats_request(['--period', '0'])).toBeUndefined()
	})
})

// joshuafolkken/kit#7007: `--since <instant>` opens the window in place of `--period`.
describe('lane_stats_request.stats_request — since', () => {
	it('reads an ISO 8601 instant with an offset as the window start', () => {
		expect(
			lane_stats_request.stats_request(['--since', SINCE, '--over', '60'])?.start,
		).toStrictEqual({ since_ms: Date.parse('2026-11-10T01:00:00.000Z') })
	})

	it.each([[['--since', 'soon']], [['--since', SINCE, '--period', '1']]])('refuses %j', (flags) => {
		expect(lane_stats_request.stats_request(flags)).toBeUndefined()
	})
})

describe('lane_stats_request.positive', () => {
	it('reads a positive number and refuses the rest', () => {
		expect(lane_stats_request.positive('2.5')).toBe(2.5)
		expect(lane_stats_request.positive('-1')).toBeUndefined()
		expect(lane_stats_request.positive(undefined)).toBeUndefined()
	})
})
