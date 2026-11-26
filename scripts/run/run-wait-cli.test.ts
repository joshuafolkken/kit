import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProcessRow } from '#scripts/lane/lane-process-table'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
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
const DIRECTORY_PREFIX = 'josh-wait-'
const PATTERN = 'run:chain 8283'
const WAIT_COMMAND = `josh wait --process ${PATTERN}`

function row(pid: number, parent: number, command: string): ProcessRow {
	return { pid, parent, command, time: '0:00', rss_kb: 1, stat: 'S', start: '' }
}

// The wait's own lineage — this process under a shell and a launcher carrying the pattern.
function own_rows(): Array<ProcessRow> {
	return [
		row(LAUNCHER_PID, 1, 'claude -p'),
		row(SHELL_PID, LAUNCHER_PID, `zsh -c pnpm ${WAIT_COMMAND}`),
		row(process.pid, SHELL_PID, `node ${WAIT_COMMAND}`),
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
		const target = path.join(create_directory(DIRECTORY_PREFIX), 'task.output')
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

	it('answers done for a pattern no other process carries', async () => {
		const probe = run_wait_cli.probe_of(['--process', `josh-wait-absent-${String(OTHER_PID)}-x`])

		expect(probe && (await run_wait_cli.wait_for(probe, NO_CHUNK))).toBe(DONE)
	})
})

describe('run_wait_cli.run', () => {
	const create_directory = temporary_directory()

	it('answers usage, not a stack, for a pattern that is not an expression', async () => {
		expect(await run_wait_cli.run(['--process', '('])).toBe(1)
	})

	it('prints the verdict and exits 0 for a target already finished', async () => {
		const target = path.join(create_directory(DIRECTORY_PREFIX), 'done.output')
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		writeFileSync(target, '')
		expect(await run_wait_cli.run(['--file', target])).toBe(0)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(`wait: ${DONE}`))
		info.mockRestore()
	})
})

describe('run_wait_cli.is_gone_in with a leftover wait', () => {
	const leftover = [
		row(OTHER_PID, 1, `zsh -c pnpm ${WAIT_COMMAND}`),
		row(OTHER_PID + 1, OTHER_PID, `node ${WAIT_COMMAND}`),
	]

	it('does not let it hold a finished target pending', () => {
		expect(run_wait_cli.is_gone_in([...own_rows(), ...leftover], PATTERN)).toBe(true)
	})

	it('still reads a running target as running beside it', () => {
		const running = row(OTHER_PID + 2, 1, 'node josh run:chain 8283 --join --worker')

		expect(run_wait_cli.is_gone_in([...own_rows(), ...leftover, running], PATTERN)).toBe(false)
	})
})

describe('run_wait_cli.is_gone_in', () => {
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

	it('answers an empty lineage for a pid the table does not list', () => {
		expect(run_wait_cli.lineage(own_rows(), OTHER_PID)).toEqual(new Set())
	})
})

describe('run_wait_cli.CHUNK_MS', () => {
	it('is the ship:wait chunk, not a second definition', () => {
		expect(run_wait_cli.CHUNK_MS).toBe(run_ship_wait_cli.CHUNK_MS)
	})
})
