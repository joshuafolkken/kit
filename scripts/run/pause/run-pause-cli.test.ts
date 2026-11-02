import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pause_cli } from './run-pause-cli'

// joshuafolkken/kit#4160: the arguments `run:pause` refuses before anything is written, and the
// report a failure leaves for the rerun.

const { pause, print_once } = vi.hoisted(() => ({
	pause: vi.fn(),
	print_once: vi.fn<(key: string) => number>(),
}))

vi.mock('./run-pause', () => ({ run_pause: { pause } }))
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { PAUSE: 'run:pause', print_once },
}))

const errors: Array<string> = []

beforeEach(() => {
	errors.length = 0
	pause.mockReset().mockResolvedValue({ kind: 'paused', done: [] })
	print_once.mockReset().mockReturnValue(0)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_pause_cli.run — arguments', () => {
	it.each([
		[['10']],
		[['10', '--for']],
		[['10', '--for', 'x']],
		[['10', '--for', '10']],
		[['--for', '11']],
		[['10', '12', '--for', '11']],
	])('refuses %j with the usage and writes nothing', async (argv) => {
		expect(await run_pause_cli.run(argv)).toBe(1)
		expect(pause).not.toHaveBeenCalled()
		expect(errors).toStrictEqual([run_pause_cli.USAGE])
	})

	it('pauses `#M` for `#N`', async () => {
		expect(await run_pause_cli.run(['10', '--for', '11'])).toBe(0)
		expect(pause).toHaveBeenCalledWith({ issue: '10', prerequisite: '11' })
	})
})

// joshuafolkken/kit#5842: a landed pause prints the section the paused run follows, once.
describe('run_pause_cli.run — the section', () => {
	it('prints the prerequisite section once the pause lands', async () => {
		expect(await run_pause_cli.run(['10', '--for', '11'])).toBe(0)
		expect(print_once).toHaveBeenCalledExactlyOnceWith('run:pause')
	})

	it('fails when the section does not resolve', async () => {
		print_once.mockReturnValue(1)

		expect(await run_pause_cli.run(['10', '--for', '11'])).toBe(1)
	})

	it('prints no section for a failed pause', async () => {
		pause.mockResolvedValue({ kind: 'failed', step: 'stash', reason: 'down', done: [] })

		expect(await run_pause_cli.run(['10', '--for', '11'])).toBe(1)
		expect(print_once).not.toHaveBeenCalled()
	})
})

describe('run_pause_cli.run — a failure', () => {
	it('names the step, what was done, and the rerun that continues', async () => {
		pause.mockResolvedValue({
			kind: 'failed',
			step: 'blocked-by',
			reason: 'down',
			done: [
				{ step: 'stash', detail: 'stashed' },
				{ step: 'comment', detail: 'url' },
			],
		})

		expect(await run_pause_cli.run(['10', '--for', '11'])).toBe(1)
		expect(errors).toStrictEqual([
			'✖ blocked-by failed: down',
			'Done: stash, comment.',
			'Rerun `pnpm josh run:pause 10 --for 11` to continue from blocked-by.',
		])
	})
})
