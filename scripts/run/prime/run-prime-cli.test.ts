import { run_startup } from '#scripts/run/startup/run-startup'
import type { StartupEntry } from '#scripts/run/startup/run-startup-schema'
import { run_startup_store } from '#scripts/run/startup/run-startup-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const { run_prime_cli } = await import('./run-prime-cli')

const OK = 0
const FAILED = 1
const MESSAGE = 'backlogrun: josh latest before lanes'
const MAIN_SYNC = ['main:sync']
const LATEST = ['latest:if-required']
const PUSH = ['stash:push', MESSAGE]
const PRUNE = ['lane:prune']
const TIDY = ['run:tidy']
const DONE = { code: OK, out: '' }
const BROKEN = { code: FAILED, out: '' }
const SKIP = { code: OK, out: 'skip' }
const REQUIRED = { code: OK, out: 'required\nlockfile updated' }
const STASHED = { code: OK, out: 'stashed' }
const CLEAN = { code: OK, out: 'clean' }
const SCOPE = { run: 'prime-run', issue: '7422', attempt: 'prime-attempt' }
const INITIAL_SYNC = 'initialization main:sync'
const rows: Array<StartupEntry> = []
const LATEST_REQUIRED = 'latest required'
const STASH_CLEAN = 'stash clean'

type Result = typeof DONE

const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

// Answers each step by its argv; a step left out answers success with no output.
function answer(results: ReadonlyArray<[ReadonlyArray<string>, Result]>): void {
	josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		const found = results.find(([call]) => call.join(' ') === argv.join(' '))

		return found?.[1] ?? DONE
	})
}

function calls(): ReadonlyArray<ReadonlyArray<string>> {
	const recorded: ReadonlyArray<ReadonlyArray<unknown>> = josh_run_mock.mock.calls

	return recorded.map((call) => call[0] as ReadonlyArray<string>)
}

function printed(): ReadonlyArray<unknown> {
	const recorded: ReadonlyArray<ReadonlyArray<unknown>> = info.mock.calls

	return recorded.map((call) => call[0])
}

beforeEach(() => {
	rows.length = 0
	vi.spyOn(run_startup_store, 'record').mockImplementation(async (row) => {
		rows.push(row)
	})
	josh_run_mock.mockReset()
	info.mockClear()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.mocked(run_startup_store.record).mockRestore())

it.each([OK, FAILED])('records initialization and child step status for exit %s', async (code) => {
	answer([
		[MAIN_SYNC, { code, out: '' }],
		[LATEST, SKIP],
	])
	await run_startup.within(SCOPE, async () => await run_prime_cli.run([]))
	const phases = run_startup_store.summarize(rows)
	const root = phases.find((row) => row.start.phase === 'initialization')
	const child = phases.find((row) => row.start.phase === INITIAL_SYNC)
	const status = code === OK ? 'done' : 'failed'

	expect(root).toMatchObject({ status, elapsed_ms: expect.any(Number) })
	expect(child).toMatchObject({
		start: { parent: root?.start.id },
		status,
		elapsed_ms: expect.any(Number),
	})
	expect(
		rows.every(
			(row) => row.run === SCOPE.run && row.issue === SCOPE.issue && row.attempt === SCOPE.attempt,
		),
	).toBe(true)
	expect(phases.map((row) => row.start.phase)).toEqual(
		code === OK
			? [
					'initialization',
					...[MAIN_SYNC, LATEST, PRUNE, TIDY].map((argv) => `initialization ${argv[0]}`),
				]
			: ['initialization', INITIAL_SYNC],
	)
})

describe('run_prime_cli.run — a primed checkout', () => {
	it('runs every step and stashes nothing on skip', async () => {
		answer([[LATEST, SKIP]])

		expect(await run_prime_cli.run([])).toBe(OK)
		expect(calls()).toStrictEqual([MAIN_SYNC, LATEST, PRUNE, TIDY])
		expect(printed()).toStrictEqual(['latest skip', STASH_CLEAN])
	})

	it('stashes the update by message on required', async () => {
		answer([
			[LATEST, REQUIRED],
			[PUSH, STASHED],
		])

		expect(await run_prime_cli.run([])).toBe(OK)
		expect(calls()).toStrictEqual([MAIN_SYNC, LATEST, PUSH, PRUNE, TIDY])
		expect(printed()).toStrictEqual([LATEST_REQUIRED, `stash ${MESSAGE}`])
	})

	it('answers clean when the update on required rewrote nothing', async () => {
		answer([
			[LATEST, REQUIRED],
			[PUSH, CLEAN],
		])

		expect(await run_prime_cli.run([])).toBe(OK)
		expect(printed()).toStrictEqual([LATEST_REQUIRED, STASH_CLEAN])
	})

	it('names the message the first lane pops', () => {
		expect(run_prime_cli.STASH_MESSAGE).toBe(MESSAGE)
	})
})

describe('run_prime_cli.run — a stop', () => {
	it.each([
		[MAIN_SYNC, [MAIN_SYNC]],
		[LATEST, [MAIN_SYNC, LATEST]],
		[PRUNE, [MAIN_SYNC, LATEST, PRUNE]],
		[TIDY, [MAIN_SYNC, LATEST, PRUNE, TIDY]],
	])('stops at a failed %s', async (failing, expected) => {
		answer([
			[failing, BROKEN],
			[LATEST, SKIP],
		])

		expect(await run_prime_cli.run([])).toBe(FAILED)
		expect(calls()).toStrictEqual(expected)
	})

	it('stops at a failed stash:push before the sweeps, printing no stash line', async () => {
		answer([
			[LATEST, REQUIRED],
			[PUSH, BROKEN],
		])

		expect(await run_prime_cli.run([])).toBe(FAILED)
		expect(calls()).toStrictEqual([MAIN_SYNC, LATEST, PUSH])
		expect(printed()).toStrictEqual([LATEST_REQUIRED])
	})

	it('refuses any argument and runs nothing', async () => {
		expect(await run_prime_cli.run(['--now'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})
