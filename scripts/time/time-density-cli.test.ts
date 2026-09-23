import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { time_density_cli } from './time-density-cli'

const { density_text } = time_transcript_fixture

// Comfortably past MIN_ROUND_TRIPS, so a case about the aggregate is never answered by the
// sample-size filter instead.
const LONG_TURNS = 40
const SHORT_TURNS = 5
const ONE_CALL = 1
const THREE_CALLS = 3
const MIN = 30
const MAX = 10

describe('time_density_cli.transcript_stats', () => {
	it('counts round trips, calls and batched turns through the guard’s own module', () => {
		const stats = time_density_cli.transcript_stats(density_text(LONG_TURNS, THREE_CALLS))

		expect(stats).toEqual({
			round_trips: LONG_TURNS,
			calls: LONG_TURNS * THREE_CALLS,
			batched: LONG_TURNS,
		})
	})

	it('reads a single-call run as no batched turns', () => {
		const stats = time_density_cli.transcript_stats(density_text(LONG_TURNS, ONE_CALL))

		expect(stats.batched).toBe(0)
	})
})

describe('time_density_cli.summarize', () => {
	it('divides one summed numerator by one summed denominator across lanes', () => {
		const texts = [density_text(LONG_TURNS, ONE_CALL), density_text(LONG_TURNS, THREE_CALLS)]

		const summary = time_density_cli.summarize(texts, MIN, MAX)

		expect(summary).toEqual({
			lanes: 2,
			round_trips: LONG_TURNS * 2,
			calls: LONG_TURNS * (ONE_CALL + THREE_CALLS),
			batched: LONG_TURNS,
			density: 2,
		})
	})

	it('reports a single-call run at 1.00 calls per round trip', () => {
		const summary = time_density_cli.summarize([density_text(LONG_TURNS, ONE_CALL)], MIN, MAX)

		expect(summary.density).toBe(ONE_CALL)
	})

	it('skips a lane holding fewer than the minimum round trips', () => {
		const texts = [density_text(SHORT_TURNS, THREE_CALLS), density_text(LONG_TURNS, ONE_CALL)]

		const summary = time_density_cli.summarize(texts, MIN, MAX)

		expect(summary.lanes).toBe(1)
		expect(summary.density).toBe(ONE_CALL)
	})

	it('caps the average at the most recent qualifying lanes', () => {
		const texts = [
			density_text(LONG_TURNS, ONE_CALL),
			density_text(LONG_TURNS, ONE_CALL),
			density_text(LONG_TURNS, THREE_CALLS),
		]

		expect(time_density_cli.summarize(texts, MIN, 2).lanes).toBe(2)
	})

	it('reports no lanes when nothing qualifies', () => {
		const summary = time_density_cli.summarize([density_text(SHORT_TURNS, ONE_CALL)], MIN, MAX)

		expect(summary).toEqual({ lanes: 0, round_trips: 0, calls: 0, batched: 0, density: 0 })
	})
})

describe('time_density_cli.format', () => {
	it('names the lanes, round trips, density and batched share on one line', () => {
		const line = time_density_cli.format({
			lanes: 10,
			round_trips: 800,
			calls: 832,
			batched: 35,
			density: 1.04,
		})

		expect(line).toBe('lanes=10 round_trips=800 tools/turn=1.04 batched=35/800')
	})
})

describe('time_density_cli.parse_options', () => {
	it('defaults to the baseline’s ten lanes', () => {
		expect(time_density_cli.parse_options([])).toEqual({
			lanes: time_density_cli.DEFAULT_LANES,
			path: undefined,
		})
	})

	it('reads --lanes and --path', () => {
		expect(time_density_cli.parse_options(['--lanes', '5', '--path', '/repo/x'])).toEqual({
			lanes: 5,
			path: '/repo/x',
		})
	})

	it('refuses a non-positive or non-integer lane count', () => {
		expect(time_density_cli.parse_options(['--lanes', '0'])).toBeUndefined()
		expect(time_density_cli.parse_options(['--lanes', 'abc'])).toBeUndefined()
	})

	it('refuses an unknown flag rather than defaulting', () => {
		expect(time_density_cli.parse_options(['--top'])).toBeUndefined()
	})
})
