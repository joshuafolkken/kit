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

function base(): string {
	return path.join(state_directory, `run-chain-${ISSUE}`)
}

// A launch that leaves a live process and, when `code` is given, the worker's output and exit code.
function launches(code?: number): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(run_review_steps, 'launch_josh').mockImplementation((_argv, log) => {
		if (code !== undefined) {
			writeFileSync(log, OUTPUT)
			run_chain_background.finish(ISSUE, code, root)
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
	vi.restoreAllMocks()
})

describe('run_chain_background.open — a worker done within the chunk', () => {
	it('starts the worker with the call’s arguments and answers its output and exit code', async () => {
		const launch = launches(STOP_EXIT)

		await expect(run_chain_background.open(ISSUE, ARGV, root)).resolves.toBe(STOP_EXIT)
		expect(launch).toHaveBeenCalledWith(
			['run:chain', ...ARGV, run_chain_background.WORKER_FLAG],
			`${base()}.log`,
			root,
		)
		expect(printed).toStrictEqual([OUTPUT])
	})

	it('clears the worker’s files once read, so the next call starts a fresh one', async () => {
		launches(0)
		await run_chain_background.open(ISSUE, ARGV, root)

		expect(run_chain_background.has_worker(ISSUE, root)).toBe(false)
		expect(existsSync(`${base()}.log`)).toBe(false)
	})

	it('waits no longer than the ship:wait chunk', async () => {
		launches(0)
		await run_chain_background.open(ISSUE, ARGV, root)

		const options = vi.mocked(run_wait_cli.wait_for).mock.calls[0]?.[1]

		expect(options?.chunk_ms).toBeLessThanOrEqual(run_ship_wait_cli.CHUNK_MS)
	})
})

describe('run_chain_background.open — a worker past the chunk', () => {
	it('answers pending with the same command as the next action and leaves the worker running', async () => {
		launches()

		await expect(run_chain_background.open(ISSUE, ARGV, root)).resolves.toBe(
			run_review.PENDING_EXIT_CODE,
		)
		expect(printed.join('\n')).toContain('pending')
		expect(printed.join('\n')).toContain(`next: re-run \`pnpm josh run:chain ${ISSUE}\``)
		expect(run_chain_background.has_worker(ISSUE, root)).toBe(true)
	})

	it('waits on the running worker on the next call rather than starting another', async () => {
		const launch = launches()

		await run_chain_background.open(ISSUE, ARGV, root)
		run_chain_background.finish(ISSUE, 0, root)

		await expect(run_chain_background.open(ISSUE, ARGV, root)).resolves.toBe(0)
		expect(launch).toHaveBeenCalledOnce()
	})
})

describe('run_chain_background.open — a worker that did not answer', () => {
	it('fails with its output when its process ended without an exit code', async () => {
		const { pid } = spawnSync('true')

		vi.spyOn(run_review_steps, 'launch_josh').mockImplementation((_argv, log) => {
			writeFileSync(log, OUTPUT)

			return { kind: 'launched', pid }
		})

		await expect(run_chain_background.open(ISSUE, ARGV, root)).resolves.toBe(FAILURE_EXIT)
		expect(printed.join('\n')).toContain('ended without an exit code')
		expect(run_chain_background.has_worker(ISSUE, root)).toBe(false)
	})

	it('fails naming the launch failure and leaves no worker', async () => {
		vi.spyOn(run_review_steps, 'launch_josh').mockReturnValue({ kind: 'failed', note: 'no pnpm' })

		await expect(run_chain_background.open(ISSUE, ARGV, root)).resolves.toBe(FAILURE_EXIT)
		expect(printed.join('\n')).toContain('no pnpm')
		expect(run_chain_background.has_worker(ISSUE, root)).toBe(false)
	})
})
