import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pause_cli } from './run-pause-cli'

// joshuafolkken/kit#4160: the arguments `run:pause` refuses before anything is written, and the
// report a failure leaves for the rerun.

const pause = vi.hoisted(() => vi.fn())

vi.mock('./run-pause', () => ({ run_pause: { pause } }))

const errors: Array<string> = []

beforeEach(() => {
	errors.length = 0
	pause.mockReset().mockResolvedValue({ kind: 'paused', done: [] })
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
