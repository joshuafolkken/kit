import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1759. The header write is the one operation on this path that can fail *after* the
// log was opened — a full disk or a quota, where `openSync` succeeds because `ensure_log` already
// created the file. It lives in its own file because pinning it means making `writeSync` throw, and
// `run-wake-session.test.ts` beside it spawns real children and reads real files.
//
// What it pins is the invariant `open_log`'s own comment states: **a log failure is never a failed
// launch.** Answering `failed` here would leave a cut `backlogrun` asleep to preserve a diagnosis.

const WRITE_NOTE = 'no space left on device'

vi.mock('node:fs', async () => {
	const original = await vi.importActual<Record<string, unknown>>('node:fs')

	return {
		...original,
		writeSync: () => {
			throw new Error(WRITE_NOTE)
		},
	}
})

const { run_wake_session } = await import('./run-wake-session')

const scratch = mkdtempSync(path.join(tmpdir(), 'run-wake-log-write-test-'))
const LOG_TARGET = path.join(scratch, 'wake.log')
const ARGV = { command: process.execPath, args: ['-e', '""'] }

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function launched_with_failing_header(): { kind: string; notes: Array<string> } {
	const notes: Array<string> = []
	const result = run_wake_session.launch(
		{ argv: ARGV, cwd: scratch, log_path: LOG_TARGET },
		(note) => {
			notes.push(note)
		},
	)

	return { kind: result.kind, notes }
}

describe('run_wake_session.launch — a header that cannot be written', () => {
	it('still starts the session', () => {
		expect(launched_with_failing_header().kind).toBe('launched')
	})

	it('says the log could not be written rather than failing quietly', () => {
		expect(launched_with_failing_header().notes.join('\n')).toContain(WRITE_NOTE)
	})
})

describe('run_wake_session.ensure_log — a log it cannot prepare', () => {
	// `ensure_log` writes no header at all, so the failure above cannot reach it: it creates the file
	// and returns, which is what lets `--list` name a path that exists on a tree where a launch would
	// lose its header.
	it('creates the file without writing anything into it', () => {
		run_wake_session.ensure_log(LOG_TARGET, () => undefined)

		expect(launched_with_failing_header().kind).toBe('launched')
	})
})
