import { describe, expect, it, vi } from 'vitest'
import { run_board_held } from './run-board-held'

const { held_reader } = run_board_held
const INTERVAL_MS = 60_000
const FAILED = new Error('read failed')

interface Fixture {
	clock: { ms: number }
	read: ReturnType<typeof vi.fn<() => Promise<string>>>
	reader: () => Promise<string>
}

function fixture_of(readings: Array<string | Error>): Fixture {
	const clock = { ms: 0 }
	const read = vi.fn(async (): Promise<string> => {
		const reading = readings.shift() ?? ''

		if (reading instanceof Error) throw reading

		return reading
	})
	const reader = held_reader({ read, now: () => clock.ms, interval_ms: INTERVAL_MS, fallback: '-' })

	return { clock, read, reader }
}

describe('run_board_held.held_reader', () => {
	it('waits for the first read alone and draws the held reading until the interval passes', async () => {
		const { clock, read, reader } = fixture_of(['first', 'second'])

		expect(await reader()).toBe('first')

		clock.ms = INTERVAL_MS - 1

		expect(await reader()).toBe('first')
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('re-reads in the background once the interval passes, drawing the held reading meanwhile', async () => {
		const { clock, read, reader } = fixture_of(['first', 'second'])

		await reader()
		clock.ms = INTERVAL_MS

		expect(await reader()).toBe('first')
		expect(read).toHaveBeenCalledTimes(2)

		await vi.waitFor(async () => {
			expect(await reader()).toBe('second')
		})
	})

	it('starts no second read while one is under way', async () => {
		const { clock, read, reader } = fixture_of(['first'])

		await reader()
		clock.ms = INTERVAL_MS
		await Promise.all([reader(), reader(), reader()])

		expect(read).toHaveBeenCalledTimes(2)
	})

	it('answers the fallback for a first read that fails and keeps a reading a later failure follows', async () => {
		const failing = fixture_of([FAILED])

		expect(await failing.reader()).toBe('-')

		const { clock, reader } = fixture_of(['first', FAILED])

		await reader()
		clock.ms = INTERVAL_MS
		await reader()

		expect(await reader()).toBe('first')
	})
})
