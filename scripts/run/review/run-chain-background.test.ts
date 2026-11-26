import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run_wait_cli } from '#scripts/run/run-wait-cli'
import { run_ship_wait_cli } from '#scripts/run/ship/run-ship-wait-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_background } from './run-chain-background'
import { run_review } from './run-review'
import { run_review_steps } from './run-review-steps'

const ISSUE = '8705'
const ARGV = [ISSUE, '--from', 'check:related']
const STOP_EXIT = 2
const FAILURE_EXIT = 1
const OUTPUT = 'run:chain 8705 — ran check:related → run:review'

// One root for the file, its worker state cleared before each test.
const root = temporary_directory('suite')('run-chain-background-')
const state_directory = path.join(root, '.josh', 'tmp')
const printed: Array<string> = []
const opening = run_chain_background.worker_of(ISSUE, run_chain_background.HALF.OPENING, root)
const join = run_chain_background.worker_of(ISSUE, run_chain_background.HALF.JOIN, root)
const JOIN_ARGV = [ISSUE, '--join']

function base(): string {
	return path.join(state_directory, `run-chain-${ISSUE}`)
}

// A launch that leaves a live process and, when `code` is given, the worker's output and exit code.
function launches(code?: number): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(run_review_steps, 'launch_josh_with').mockImplementation((_argv, log) => {
		if (code !== undefined) {
			writeFileSync(log, OUTPUT)
			run_chain_background.finish(opening, code)
		}

		return { kind: 'launched', pid: process.pid }
	})
}

// One read of the probe stands in for the chunk's polling.
function waits_once(): ReturnType<typeof vi.spyOn> {
	return vi
		.spyOn(run_wait_cli, 'wait_for')
		.mockImplementation(async (is_done) =>
			(await is_done()) ? run_wait_cli.VERDICT.DONE : run_wait_cli.VERDICT.PENDING,
		)
}

beforeEach(() => {
	rmSync(state_directory, { recursive: true, force: true })
	printed.length = 0

	for (const channel of ['info', 'error'] as const) {
		vi.spyOn(console, channel).mockImplementation((line: string) => {
			printed.push(line)
		})
	}

	waits_once()
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_chain_background.open — a worker done within the chunk', () => {
	it('starts the worker with the call’s arguments and answers its output and exit code', async () => {
		const launch = launches(STOP_EXIT)

		await expect(run_chain_background.open(opening, ARGV)).resolves.toBe(STOP_EXIT)
		expect(launch).toHaveBeenCalledWith(
			['run:chain', ...ARGV, run_chain_background.WORKER_FLAG],
			`${base()}.log`,
			root,
			expect.any(Object),
		)
		expect(printed).toStrictEqual([OUTPUT])
	})

	it('clears the worker’s files once read, so the next call starts a fresh one', async () => {
		launches(0)
		await run_chain_background.open(opening, ARGV)

		expect(run_chain_background.has_worker(opening)).toBe(false)
		expect(existsSync(`${base()}.log`)).toBe(false)
	})

	it('waits no longer than the ship:wait chunk', async () => {
		launches(0)
		await run_chain_background.open(opening, ARGV)

		const options = vi.mocked(run_wait_cli.wait_for).mock.calls[0]?.[1]

		expect(options?.chunk_ms).toBeLessThanOrEqual(run_ship_wait_cli.CHUNK_MS)
	})
})

describe('run_chain_background.open — a worker past the chunk', () => {
	it('answers pending with the same command as the next action and leaves the worker running', async () => {
		launches()

		await expect(run_chain_background.open(opening, ARGV)).resolves.toBe(
			run_review.PENDING_EXIT_CODE,
		)
		expect(printed.join('\n')).toContain('pending')
		expect(printed.join('\n')).toContain(
			`next: re-run the same \`pnpm josh run:chain ${ISSUE}\` call`,
		)
		expect(run_chain_background.has_worker(opening)).toBe(true)
	})

	it('waits on the running worker on the next call rather than starting another', async () => {
		const launch = launches()

		await run_chain_background.open(opening, ARGV)
		run_chain_background.finish(opening, 0)

		await expect(run_chain_background.open(opening, ARGV)).resolves.toBe(0)
		expect(launch).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#8761: the join's worker keeps its own files beside the opening's.
describe('run_chain_background — the join’s worker (ac-4c8354b7)', () => {
	it('logs to the join’s own files, apart from the opening’s', async () => {
		const launch = launches()

		await run_chain_background.open(join, JOIN_ARGV)

		expect(launch).toHaveBeenCalledWith(
			expect.anything(),
			`${base()}-join.log`,
			root,
			expect.any(Object),
		)
		expect(run_chain_background.has_worker(join)).toBe(true)
		expect(run_chain_background.has_worker(opening)).toBe(false)
	})

	it('settles the join’s worker on a re-run, starting no second one', async () => {
		const launch = launches()

		await run_chain_background.open(join, JOIN_ARGV)
		run_chain_background.finish(join, STOP_EXIT)

		await expect(run_chain_background.open(join, JOIN_ARGV)).resolves.toBe(STOP_EXIT)
		expect(launch).toHaveBeenCalledOnce()
		expect(run_chain_background.has_worker(join)).toBe(false)
	})
})

describe('run_chain_background — the session id forwarded to the worker', () => {
	const SESSION_ID = 'session-8761'

	it('forwards the agent session id under its own key, since the detached launch strips it', async () => {
		vi.stubEnv('CLAUDE_CODE_SESSION_ID', SESSION_ID)
		const launch = launches()

		await run_chain_background.open(opening, ARGV)

		expect(launch).toHaveBeenCalledWith(expect.anything(), `${base()}.log`, root, {
			JOSH_RUN_CHAIN_SESSION_ID: SESSION_ID,
		})
	})

	it('forwards nothing outside an agent session', () => {
		expect(run_chain_background.forwarded_environment({})).toStrictEqual({})
	})

	it('puts the forwarded id back as the session id in the worker', () => {
		const environment: Record<string, string | undefined> = {
			JOSH_RUN_CHAIN_SESSION_ID: SESSION_ID,
		}

		run_chain_background.adopt_session(environment)

		expect(environment['CLAUDE_CODE_SESSION_ID']).toBe(SESSION_ID)
	})

	it('leaves the environment as it is when nothing was forwarded', () => {
		const environment = { PATH: '/bin' }

		run_chain_background.adopt_session(environment)

		expect(environment).toStrictEqual({ PATH: '/bin' })
	})
})

describe('run_chain_background.open — a worker that did not answer', () => {
	it('fails with its output when its process ended without an exit code', async () => {
		const { pid } = spawnSync('true')

		vi.spyOn(run_review_steps, 'launch_josh_with').mockImplementation((_argv, log) => {
			writeFileSync(log, OUTPUT)

			return { kind: 'launched', pid }
		})

		await expect(run_chain_background.open(opening, ARGV)).resolves.toBe(FAILURE_EXIT)
		expect(printed.join('\n')).toContain('ended without an exit code')
		expect(run_chain_background.has_worker(opening)).toBe(false)
	})

	it('fails naming the launch failure and leaves no worker', async () => {
		vi.spyOn(run_review_steps, 'launch_josh_with').mockReturnValue({
			kind: 'failed',
			note: 'no pnpm',
		})

		await expect(run_chain_background.open(opening, ARGV)).resolves.toBe(FAILURE_EXIT)
		expect(printed.join('\n')).toContain('no pnpm')
		expect(run_chain_background.has_worker(opening)).toBe(false)
	})
})
