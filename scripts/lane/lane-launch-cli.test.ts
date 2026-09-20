import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('execa', () => ({ execa: vi.fn() }))

const { lane_launch_cli } = await import('./lane-launch-cli')

const mocked_execa = vi.mocked(execa)

const OK = 0
const FAILED = 1
const ISSUE = '17'
const DIR = '/lanes/17'
const PID = '4242'
const OPEN = 'lane:open'
const POP = 'stash:pop'
const DISPATCH = 'lane:dispatch'
const STASH = ['--stash', 'backlogrun: josh latest before lanes']

interface JoshResult {
	code: number
	out: string
}

interface Stubs {
	open: JoshResult
	pop?: JoshResult
	dispatch?: JoshResult
}

const info_lines: Array<string> = []

// Route each `pnpm josh` subcommand to its stubbed result; a pop or dispatch left unset succeeds
// silently, so a test names only the steps it cares about.
function route(args: ReadonlyArray<string>, stubs: Stubs): JoshResult {
	if (args[0] === OPEN) return stubs.open
	if (args[0] === POP) return stubs.pop ?? { code: OK, out: '' }

	return stubs.dispatch ?? { code: OK, out: '' }
}

function stub(stubs: Stubs): void {
	josh_run_mock.mockImplementation(async (args: ReadonlyArray<string>) => route(args, stubs))
}

function stub_install(exit_code: number): void {
	const result = { exitCode: exit_code, stdout: '', stderr: '' }

	mocked_execa.mockResolvedValue(result as unknown as Awaited<ReturnType<typeof execa>>)
}

function called(subcommand: string): boolean {
	return josh_run_mock.mock.calls.some((call) => {
		const args = call[0] as ReadonlyArray<string>

		return args[0] === subcommand
	})
}

beforeEach(() => {
	josh_run_mock.mockReset()
	mocked_execa.mockReset()
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('lane_launch_cli.run — a refused lane:open never dispatches', () => {
	it('propagates the refusal and starts no child', async () => {
		stub({ open: { code: FAILED, out: '' } })

		expect(await lane_launch_cli.run([ISSUE])).toBe(FAILED)
		expect(called(DISPATCH)).toBe(false)
	})
})

describe('lane_launch_cli.run — the ordinary lane, no stash', () => {
	it('opens, dispatches, and prints the child pid without popping or re-installing', async () => {
		stub({ open: { code: OK, out: DIR }, dispatch: { code: OK, out: PID } })

		expect(await lane_launch_cli.run([ISSUE])).toBe(OK)
		expect(info_lines).toStrictEqual([PID])
		expect(called(POP)).toBe(false)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('lane_launch_cli.run — the first lane pops and re-installs', () => {
	it('pops the stash and installs before dispatching when --stash is given', async () => {
		stub({ open: { code: OK, out: DIR }, dispatch: { code: OK, out: PID } })
		stub_install(OK)

		expect(await lane_launch_cli.run([ISSUE, ...STASH])).toBe(OK)
		expect(called(POP)).toBe(true)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['--dir', DIR, 'install', '--frozen-lockfile'],
			{ reject: false },
		)
		expect(info_lines).toStrictEqual([PID])
	})

	it('stops the lane when the pop refuses, never installing or dispatching', async () => {
		stub({ open: { code: OK, out: DIR }, pop: { code: FAILED, out: '' } })

		expect(await lane_launch_cli.run([ISSUE, ...STASH])).toBe(FAILED)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(called(DISPATCH)).toBe(false)
	})

	it('stops the lane when the re-install fails, never dispatching', async () => {
		stub({ open: { code: OK, out: DIR } })
		stub_install(FAILED)

		expect(await lane_launch_cli.run([ISSUE, ...STASH])).toBe(FAILED)
		expect(called(DISPATCH)).toBe(false)
	})
})

describe('lane_launch_cli.run — a refused dispatch', () => {
	it('propagates the dispatch refusal', async () => {
		stub({ open: { code: OK, out: DIR }, dispatch: { code: FAILED, out: '' } })

		expect(await lane_launch_cli.run([ISSUE])).toBe(FAILED)
		expect(info_lines).toStrictEqual([])
	})
})

describe('lane_launch_cli.read_context — the argument shape', () => {
	it('reads the issue number and an optional stash message', () => {
		expect(lane_launch_cli.read_context([ISSUE])).toStrictEqual({ issue: ISSUE, stash: undefined })
		expect(lane_launch_cli.read_context([ISSUE, ...STASH])).toStrictEqual({
			issue: ISSUE,
			stash: STASH[1],
		})
	})

	it('refuses a missing, extra, or non-numeric issue', () => {
		expect(lane_launch_cli.read_context([])).toBeUndefined()
		expect(lane_launch_cli.read_context([ISSUE, '18'])).toBeUndefined()
		expect(lane_launch_cli.read_context(['nope'])).toBeUndefined()
	})
})
