import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { run_board_thanks_read, type ThanksDependencies } from './run-board-thanks-read'

// joshuafolkken/kit#3809: the roster is read at run time, kept in the project's record for five
// minutes, and a read that fails — or times out — keeps the last answer, or none.

const { TTL_MS, read_thanks } = run_board_thanks_read
const START = Date.parse('2026-10-14T09:00:00.000Z')
const ROSTER = 'name,url\nfish,\nKittenLab,https://x.com/KittenLab\n'
const FISH = { name: 'fish', url: undefined }
const KITTEN = { name: 'KittenLab', url: 'https://x.com/KittenLab' }
const TIMED_OUT = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
const scratch = mkdtempSync(path.join(tmpdir(), 'run-board-thanks-read-test-'))

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

interface Clock {
	now_ms: number
}

// Each test keeps its own record, so no answer leaks from one into the next.
function dependencies(fetch_text: () => Promise<string>, clock: Clock): ThanksDependencies {
	const record_path = path.join(mkdtempSync(path.join(scratch, 'case-')), 'thanks.json')

	return { fetch_text, record_path, now: () => clock.now_ms }
}

async function timing_out(): Promise<string> {
	throw TIMED_OUT
}

// A record already holding the roster, read at `START`.
async function recorded_roster(): Promise<string> {
	const deps = dependencies(async () => ROSTER, { now_ms: START })

	await read_thanks(deps)

	return deps.record_path
}

describe('run_board_thanks_read.read_thanks', () => {
	it('reads the roster, and reads it again only once five minutes have passed', async () => {
		const fetch_text = vi.fn(async () => ROSTER)
		const clock = { now_ms: START }
		const deps = dependencies(fetch_text, clock)

		await expect(read_thanks(deps)).resolves.toStrictEqual([FISH, KITTEN])

		clock.now_ms = START + TTL_MS - 1
		await expect(read_thanks(deps)).resolves.toStrictEqual([FISH, KITTEN])
		expect(fetch_text).toHaveBeenCalledTimes(1)

		clock.now_ms = START + TTL_MS
		await read_thanks(deps)
		expect(fetch_text).toHaveBeenCalledTimes(2)
	})

	it.each([
		['times out', timing_out],
		['answers with a text that is not the roster', async () => '<html>sign in</html>'],
	])('keeps the last answer when a later read %s', async (_label, fetch_text) => {
		const record_path = await recorded_roster()
		const stale = { fetch_text, record_path, now: () => START + TTL_MS }

		await expect(read_thanks(stale)).resolves.toStrictEqual([FISH, KITTEN])
	})

	it('answers no one when the read fails with no answer kept', async () => {
		await expect(read_thanks(dependencies(timing_out, { now_ms: START }))).resolves.toStrictEqual(
			[],
		)
	})
})

describe('run_board_thanks_read.read_thanks record', () => {
	it('waits the five minutes after a failed read too, rather than asking at every redraw', async () => {
		const fetch_text = vi.fn(timing_out)
		const deps = dependencies(fetch_text, { now_ms: START })

		await read_thanks(deps)
		await read_thanks(deps)

		expect(fetch_text).toHaveBeenCalledTimes(1)
	})

	it('reads the roster again over a record dated after now', async () => {
		const fetch_text = vi.fn(async () => ROSTER)
		const clock = { now_ms: START }
		const deps = dependencies(fetch_text, clock)

		await read_thanks(deps)
		clock.now_ms = START - 1
		await read_thanks(deps)

		expect(fetch_text).toHaveBeenCalledTimes(2)
	})

	it('reads the roster again over a record it cannot parse', async () => {
		const deps = dependencies(async () => ROSTER, { now_ms: START })

		writeFileSync(deps.record_path, '{not json')

		await expect(read_thanks(deps)).resolves.toStrictEqual([FISH, KITTEN])
	})
})
