import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_event_stream } from './run-event-stream'

// joshuafolkken/kit#3446: the parent, a cut successor and every lane child append to one stream, and an
// unlocked read-then-rewrite lost one writer's events to another's or threw `EEXIST`. These pin the
// per-stream lock: concurrent writers in separate processes keep every event, a crashed holder's lock
// is reclaimed, and a lock held past the wait is reported rather than silently dropped.

const AT = '2026-10-08T00:00:00.000Z'
const WRITERS = 4
const PER_WRITER = 25
const LOCK_SUFFIX = '.lock'
// A pid far above any real process table, so it reads as a process that is certainly gone.
const DEAD_PID = 2_147_483_000
// Far past any wait the append allows, so the second clock read ends the wait at once.
const LONG_AFTER_MS = 1_000_000_000
const SPAWN_TIMEOUT_MS = 60_000
const GAVE_UP = 'gave up waiting for the lock'
const STREAM_MODULE = path.join(import.meta.dirname, 'run-event-stream.ts')
const WRITER_SOURCE = [
	`import { run_event_stream } from ${JSON.stringify(STREAM_MODULE)}`,
	'const [target, id] = process.argv.slice(-2)',
	`for (let index = 0; index < ${String(PER_WRITER)}; index++) {`,
	"\trun_event_stream.append(target, 'note', `w${id} ${index}`, new Date().toISOString())",
	'}',
].join('\n')
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-stream-lock-'))

function fresh_target(): string {
	return path.join(TEMPORARY, `${randomUUID()}.jsonl`)
}

async function run_writer(target: string, id: number): Promise<number | null> {
	const child = spawn(
		process.execPath,
		['--import', 'tsx', '--input-type=module', '--eval', WRITER_SOURCE, target, String(id)],
		{ stdio: 'ignore', timeout: SPAWN_TIMEOUT_MS },
	)

	return await new Promise((resolve) => child.once('exit', resolve))
}

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_event_stream.append — concurrent writers', () => {
	it(
		'keeps every event from four processes appending at once, each at a distinct position',
		async () => {
			const target = fresh_target()
			const writers = Array.from({ length: WRITERS }, async (_, id) => await run_writer(target, id))

			expect(await Promise.all(writers)).toStrictEqual(Array.from({ length: WRITERS }, () => 0))

			const positions = run_event_stream.read_events(target).map((event) => event.pos)

			expect(positions).toHaveLength(WRITERS * PER_WRITER)
			expect(new Set(positions).size).toBe(WRITERS * PER_WRITER)
			expect(existsSync(`${target}${LOCK_SUFFIX}`)).toBe(false)
		},
		SPAWN_TIMEOUT_MS,
	)
})

describe('run_event_stream.append — the stream lock', () => {
	it('reclaims a lock left by a holder that is gone and appends', () => {
		const target = fresh_target()

		writeFileSync(`${target}${LOCK_SUFFIX}`, JSON.stringify({ pid: DEAD_PID }))

		expect(run_event_stream.append(target, 'note', 'after a crash', AT).position).toBe(1)
		expect(existsSync(`${target}${LOCK_SUFFIX}`)).toBe(false)
	})

	it('reports on stderr and throws when a live holder keeps the lock past the wait', () => {
		const target = fresh_target()
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		writeFileSync(`${target}${LOCK_SUFFIX}`, JSON.stringify({ pid: process.ppid }))
		vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(LONG_AFTER_MS)

		expect(() => run_event_stream.append(target, 'note', 'blocked', AT)).toThrow(GAVE_UP)
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining(GAVE_UP))
		expect(run_event_stream.read_events(target)).toHaveLength(0)
	})
})
