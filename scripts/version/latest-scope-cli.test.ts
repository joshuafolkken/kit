import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_scope_cli } from './latest-scope-cli'
import { latest_stamp, type LatestStamp } from './latest-stamp'

// joshuafolkken/kit#1215: a command rather than a paragraph, for the reason `josh review:level` is
// one — the rule is argued against every time it is reached, so the answer is read rather than
// decided.

const NOW = new Date('2026-09-02T12:00:00.000Z')
const RECENT = { ran_at: '2026-09-02T10:00:00.000Z' } satisfies LatestStamp
const OLD = { ran_at: '2026-09-01T16:00:00.000Z' } satisfies LatestStamp
const STAMP_PATH = '/var/records/josh-latest-stamp-test.json'
const WINDOW_TEXT = '12.0h window'

interface Captured {
	stdout: Array<string>
	stderr: Array<string>
}

// Spied inside each test rather than into a shared variable: the streams are what this command's
// contract is written in — the answer on one, the reason on the other — so each test states which
// one it is reading.
function capture(): Captured {
	const captured: Captured = { stdout: [], stderr: [] }

	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		captured.stdout.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		captured.stderr.push(String(line))
	})

	return captured
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(NOW)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('latest_scope_cli.decide', () => {
	// No record is not "the dependencies are current": a fresh checkout, a cleared temp directory or
	// a run that fell over halfway all land here, and every one of them wants the update.
	it('requires the update when there is no record', () => {
		vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(undefined)

		expect(latest_scope_cli.decide()).toStrictEqual({
			scope: latest_scope_cli.REQUIRED_SCOPE,
			reason: latest_scope_cli.NO_STAMP_REASON,
		})
	})

	it('skips the update while the record is inside the window', () => {
		vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(RECENT)

		expect(latest_scope_cli.decide().scope).toBe(latest_scope_cli.SKIPPED_SCOPE)
	})

	it('requires the update once the record is past the window', () => {
		vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(OLD)

		expect(latest_scope_cli.decide().scope).toBe(latest_scope_cli.REQUIRED_SCOPE)
	})

	// The age alone says nothing about why it was enough; the window has to be beside it.
	it('names both the age and the window', () => {
		vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(RECENT)
		const { reason } = latest_scope_cli.decide()

		expect(reason).toContain('2.0h ago')
		expect(reason).toContain(WINDOW_TEXT)
	})
})

describe('latest_scope_cli.run', () => {
	// The answer alone on stdout so `$(pnpm josh latest:scope)` reads it, the reason on stderr.
	it('prints the answer on stdout and the reason on stderr', () => {
		vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(RECENT)
		const captured = capture()

		expect(latest_scope_cli.run([])).toBe(0)
		expect(captured.stdout).toStrictEqual([latest_scope_cli.SKIPPED_SCOPE])
		expect(captured.stderr[0]).toContain(WINDOW_TEXT)
	})

	it('puts both in one object under --json', () => {
		vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(OLD)
		const captured = capture()

		latest_scope_cli.run(['--json'])

		expect(JSON.parse(captured.stdout[0] ?? '')).toMatchObject({
			[latest_scope_cli.JSON_KEY]: latest_scope_cli.REQUIRED_SCOPE,
		})
	})

	// A misspelled record flag that silently answered the read question would tell a caller the
	// dependencies are current on the strength of a flag that did nothing.
	it('refuses an unknown flag rather than defaulting', () => {
		const captured = capture()

		expect(latest_scope_cli.run(['--reset'])).toBe(1)
		expect(captured.stderr).toStrictEqual([latest_scope_cli.USAGE])
	})
})

describe('latest_scope_cli.run --record', () => {
	// Nothing on stdout: a caller capturing the command must never be handed a scope by the
	// invocation that was only meant to note a run down.
	it('writes the record and prints nothing on stdout', () => {
		const write = vi.spyOn(latest_stamp, 'write_stamp').mockReturnValue(STAMP_PATH)
		const captured = capture()

		expect(latest_scope_cli.run([latest_scope_cli.RECORD_FLAG])).toBe(0)
		expect(write).toHaveBeenCalledOnce()
		expect(captured.stdout).toStrictEqual([])
		expect(captured.stderr[0]).toContain(STAMP_PATH)
	})
})
