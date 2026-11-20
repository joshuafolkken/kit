import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProcessRow } from '#scripts/lane/lane-process-table'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_wait_cli } from './run-wait-cli'
import { run_ship_wait_cli } from './ship/run-ship-wait-cli'

async function no_sleep(): Promise<void> {
	await Promise.resolve()
}

const { DONE, PENDING } = run_wait_cli.VERDICT
const NO_CHUNK = { chunk_ms: 0, sleeper: no_sleep }
const LONG_CHUNK = { chunk_ms: 60_000, sleeper: no_sleep }
const OTHER_PID = 424_242
const SHELL_PID = 900_001
const LAUNCHER_PID = 900_002

function row(pid: number, parent: number, command: string): ProcessRow {
	return { pid, parent, command, time: '0:00', rss_kb: 1, stat: 'S', start: '' }
}

// The wait's own lineage — this process under a shell and a launcher carrying the pattern.
function own_rows(): Array<ProcessRow> {
	return [
		row(LAUNCHER_PID, 1, 'claude -p'),
		row(SHELL_PID, LAUNCHER_PID, 'zsh -c pnpm josh wait --process run:chain 8283'),
		row(process.pid, SHELL_PID, 'node josh wait --process run:chain 8283'),
	]
}

describe('run_wait_cli.wait_for', () => {
	it('answers done once the target finishes', async () => {
		const answers = [false, false, true]

		expect(await run_wait_cli.wait_for(() => answers.shift() ?? true, LONG_CHUNK)).toBe(DONE)
	})

	it('answers pending at the chunk while the target runs', async () => {
		expect(await run_wait_cli.wait_for(() => false, NO_CHUNK)).toBe(PENDING)
	})
})

describe('run_wait_cli.probe_of', () => {
	const create_directory = temporary_directory()

	it('answers done for a pid that is gone and pending for a live one', async () => {
		const gone = run_wait_cli.probe_of(['--pid', String(2 ** 22 + 1)])
		const live = run_wait_cli.probe_of(['--pid', String(process.pid)])

		expect(gone && (await run_wait_cli.wait_for(gone, NO_CHUNK))).toBe(DONE)
		expect(live && (await run_wait_cli.wait_for(live, NO_CHUNK))).toBe(PENDING)
	})

	it('answers done once the file appears', async () => {
		const target = path.join(create_directory('josh-wait-'), 'task.output')
		const probe = run_wait_cli.probe_of(['--file', target])

		expect(probe && (await run_wait_cli.wait_for(probe, NO_CHUNK))).toBe(PENDING)
		writeFileSync(target, '')
		expect(probe && (await run_wait_cli.wait_for(probe, NO_CHUNK))).toBe(DONE)
	})

	it('waits out the chunk with no target', async () => {
		const probe = run_wait_cli.probe_of([])

		expect(probe && (await run_wait_cli.wait_for(probe, NO_CHUNK))).toBe(PENDING)
	})

	it('refuses two targets, a pid that does not read and an unknown flag', () => {
		expect(run_wait_cli.probe_of(['--pid', '1', '--file', 'x'])).toBeUndefined()
		expect(run_wait_cli.probe_of(['--pid', 'abc'])).toBeUndefined()
		expect(() => run_wait_cli.probe_of(['--every', '5'])).toThrow()
	})
})

describe('run_wait_cli.is_gone_in', () => {
	const PATTERN = 'run:chain 8283'

	it('reads only its own lineage as matching: gone', () => {
		expect(run_wait_cli.is_gone_in(own_rows(), PATTERN)).toBe(true)
	})

	it('reads another matching process as running', () => {
		const rows = [...own_rows(), row(OTHER_PID, 1, 'node josh run:chain 8283')]

		expect(run_wait_cli.is_gone_in(rows, PATTERN)).toBe(false)
	})

	it('reads an unanswered ps as running', () => {
		expect(run_wait_cli.is_gone_in(undefined, PATTERN)).toBe(false)
	})

	it('walks the lineage up to the root without looping', () => {
		const looped = [row(SHELL_PID, LAUNCHER_PID, 'zsh'), row(LAUNCHER_PID, SHELL_PID, 'claude')]

		expect(run_wait_cli.lineage(own_rows(), process.pid)).toEqual(
			new Set([process.pid, SHELL_PID, LAUNCHER_PID, 1]),
		)
		expect(run_wait_cli.lineage(looped, SHELL_PID)).toEqual(new Set([SHELL_PID, LAUNCHER_PID]))
	})
})

describe('run_wait_cli.CHUNK_MS', () => {
	it('is the ship:wait chunk, not a second definition', () => {
		expect(run_wait_cli.CHUNK_MS).toBe(run_ship_wait_cli.CHUNK_MS)
	})
})
