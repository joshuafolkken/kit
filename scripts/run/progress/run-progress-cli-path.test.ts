import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2156: `--path` names the ambient heartbeat log a person keeps open with `tail -F`
// to watch a run stream on across a session cut. It reads no run state and starts no watcher, so it is
// exercised on its own — the reporting paths are driven in `run-progress-cli.test.ts`, whose file is at
// its line limit.
vi.mock('./run-progress-read', () => ({
	run_progress_read: {
		live_target: vi.fn(),
		log_target: vi.fn(),
		mark: vi.fn(),
		read_last_report: vi.fn(),
		read_observations: vi.fn(),
		stamp_target: vi.fn(),
	},
}))

const { run_progress_read } = await import('./run-progress-read')
const { run_progress_cli } = await import('./run-progress-cli')

const log_target = vi.mocked(run_progress_read.log_target)
const read_observations = vi.mocked(run_progress_read.read_observations)
// A stand-in path — `log_target` is mocked, so this is only compared, never written to.
const AMBIENT = '/scratch/josh-run-progress-abc.json.log'

const printed: Array<string> = []

beforeEach(() => {
	printed.length = 0
	vi.spyOn(console, 'info').mockImplementation((...args) => {
		printed.push(args.join(' '))
	})
	log_target.mockResolvedValue(AMBIENT)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('josh run:progress --path', () => {
	it('prints the ambient log path and reads no run state', async () => {
		await expect(run_progress_cli.run(['--path'])).resolves.toBe(0)

		expect(printed).toStrictEqual([AMBIENT])
		expect(read_observations).not.toHaveBeenCalled()
	})
})
