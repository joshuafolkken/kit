import type { JoshResult } from '#scripts/josh/josh-run'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('./lane-launch-admission', () => ({
	lane_launch_admission: {
		launch: async (context: unknown, run: (context: unknown) => Promise<unknown>) =>
			await run(context),
	},
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: vi.fn().mockResolvedValue(undefined) },
}))

const { lane_launch_cli } = await import('./lane-launch-cli')

const mocked_execa = vi.mocked(execa)

const OK = 0
const FAILED = 1
const ISSUE = '17'
const DIR = '/lanes/17'
const PID = '4242'
const STASH = 'backlogrun: josh latest before lanes'
const OPENED: JoshResult = { code: OK, out: DIR }
const PASSED: JoshResult = { code: OK, out: PID }
const REASON = 'lane pool is full'
const LOCKFILE_ERROR = 'ERR_PNPM_OUTDATED_LOCKFILE'
const LOCKFILE_NOTE = 'Lockfile is out of date'

interface Stubs {
	open: JoshResult
	pop?: JoshResult
	dispatch?: JoshResult
}

function stub(stubs: Stubs): void {
	josh_run_mock.mockImplementation(async (args: ReadonlyArray<string>) => {
		if (args[0] === 'lane:open') return stubs.open
		if (args[0] === 'stash:pop') return stubs.pop ?? PASSED

		return stubs.dispatch ?? PASSED
	})
}

function stub_install(stdout: string, stderr: string): void {
	const result = { exitCode: FAILED, stdout, stderr }

	mocked_execa.mockResolvedValue(result as unknown as Awaited<ReturnType<typeof execa>>)
}

beforeEach(() => {
	josh_run_mock.mockReset()
	mocked_execa.mockReset()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(run_event_setup, 'emit').mockReset().mockResolvedValue()
})

// joshuafolkken/kit#6551: a refusal keeps the failing step's own explanation for the run's stream.
describe('lane_launch_cli.launch_lane — the detail a refused lane:open carries', () => {
	it('keeps its stderr on the unopened outcome', async () => {
		stub({ open: { code: FAILED, out: '', err: REASON } })

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toStrictEqual({
			kind: 'unopened',
			detail: REASON,
		})
	})

	it('falls back to stdout when stderr is empty', async () => {
		stub({ open: { code: FAILED, out: ` ${REASON}\n`, err: '' } })

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toStrictEqual({
			kind: 'unopened',
			detail: REASON,
		})
	})

	it('carries no detail when the step said nothing', async () => {
		stub({ open: { code: FAILED, out: ' ', err: '' } })

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toStrictEqual({
			kind: 'unopened',
		})
	})
})

describe('lane_launch_cli.launch_lane — the detail a step after the open carries', () => {
	it('returns a retryable wait when dispatch finds a new blocker', async () => {
		stub({ open: OPENED, dispatch: { code: 75, out: '', err: 'unfinished blocker' } })
		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toEqual({
			kind: 'waiting',
		})
	})

	it('keeps a refused stash pop’s stderr on the failed outcome', async () => {
		stub({ open: OPENED, pop: { code: FAILED, out: 'ignored', err: 'no-match' } })

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: STASH })).toStrictEqual({
			kind: 'failed',
			detail: 'no-match',
		})
	})

	it.each([
		['stderr', '', LOCKFILE_ERROR, LOCKFILE_ERROR],
		['stdout when stderr is empty', LOCKFILE_NOTE, '', LOCKFILE_NOTE],
	])('keeps a failed re-install’s %s', async (_name, stdout, stderr, detail) => {
		stub({ open: OPENED })
		stub_install(stdout, stderr)

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: STASH })).toStrictEqual({
			kind: 'failed',
			detail,
		})
	})

	it('keeps a refused dispatch’s stderr on the failed outcome', async () => {
		const claimed = 'already in progress'

		stub({ open: OPENED, dispatch: { code: FAILED, out: '', err: claimed } })

		expect(await lane_launch_cli.launch_lane({ issue: ISSUE, stash: undefined })).toStrictEqual({
			kind: 'failed',
			detail: claimed,
		})
	})
})
