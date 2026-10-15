import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_sampler } from '#scripts/lane/lane-sampler'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_merge_cli } from '#scripts/run/merge/run-merge-cli'
import { describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_owner } from './backlog-drive-owner'

const ACTIVE = '2026-09-24T00:00:00.000Z'
const MS_PER_MINUTE = 60_000
const WINDOW_MINUTES = 9

const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-09-23T23:00:00.000Z',
	merged: 3,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

describe('backlog_drive_cli.parse', () => {
	it('reads the owner, the forwarded budgets, the lists and the window', () => {
		const context = backlog_drive_cli.parse([
			'--owner',
			'4242',
			'--max',
			'5',
			'--exclude',
			'2400,2401',
			'--await',
			'2500',
			'--window',
			String(WINDOW_MINUTES),
		])

		expect(context).toStrictEqual({
			owner: '4242',
			active: undefined,
			forwarded: ['--max', '5'],
			exclude: ['2400', '2401'],
			awaited: ['2500'],
			window_ms: WINDOW_MINUTES * MS_PER_MINUTE,
			window: String(WINDOW_MINUTES),
			is_only: false,
			stopped: undefined,
		})
	})
})

it.each([
	[[]],
	[['--owner', 'abc']],
	[['--owner', '1', '--exclude', '2400,--evil']],
	[['--owner', '1', '--exclude', '0']],
	[['--owner', '1', '--await', '2400,0']],
	[['--owner', '1', '--stopped', '0']],
	[['--owner', '1', '--max', 'many']],
	[['--owner', '1', '--window', 'soon']],
	[['--owner', '1', '--unknown', 'x']],
])('refuses %j', (argv) => {
	expect(backlog_drive_cli.parse(argv)).toBeUndefined()
})

describe('backlog_drive_cli.offer_argv', () => {
	it('takes started and merged from the carry record and the rest from the loop state', () => {
		const state = {
			...backlog_drive.initial_state(['2500'], ACTIVE),
			exclude: ['2400'],
			retries: 1,
		}

		expect(backlog_drive_cli.offer_argv(state, CARRY, ['--idle', '0'])).toStrictEqual([
			'backlog:offer',
			'--json',
			'--started',
			CARRY.started_at,
			'--active',
			ACTIVE,
			'--merged',
			'3',
			'--running',
			'1',
			'--retries',
			'1',
			'--exclude',
			'2400,2500',
			'--idle',
			'0',
		])
	})

	it('never offers a child still in flight, even one GitHub already reads unclaimed', () => {
		const state = backlog_drive.initial_state(['2500', '2501'], ACTIVE)
		const argv = backlog_drive_cli.offer_argv(state, CARRY, [])

		expect(argv.slice(argv.indexOf('--exclude'))).toStrictEqual(['--exclude', '2500,2501'])
	})
})

describe('backlog_drive_cli.merge', () => {
	it('merges without a hand-off threshold, so the supervisor is never handed back over', async () => {
		vi.spyOn(backlog_drive_owner, 'assert_current').mockResolvedValue(CARRY)
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
		vi.spyOn(backlog_drive_named, 'mark_done').mockResolvedValue()
		const merge_child = vi
			.spyOn(run_merge_cli, 'merge_child')
			.mockResolvedValue({ token: '2600', code: 0, outcome: 'merged', is_offer: true })

		await backlog_drive_cli.merge('2500', '4242')

		expect(merge_child).toHaveBeenCalledWith(expect.objectContaining({ over: undefined }))
		vi.restoreAllMocks()
	})
})

describe('backlog_drive_cli output', () => {
	it('reads the offer backlog:offer --json prints', () => {
		const out = JSON.stringify({ offer: { verdict: 'run', issues: ['2500'], retries: 0 } })

		expect(backlog_drive_cli.to_offer(out)).toStrictEqual({
			verdict: 'run',
			issues: ['2500'],
			retries: 0,
		})
		expect(backlog_drive_cli.to_offer('not json')).toBeUndefined()
	})

	it('prints the hand-back with its token and child', () => {
		expect(backlog_drive_cli.end_line({ reason: 'merge', token: 'over', issue: '2493' })).toBe(
			'merge over #2493',
		)
		expect(
			backlog_drive_cli.end_line({
				reason: 'stop',
				token: 'stop',
				issue: undefined,
				detail: 'max',
			}),
		).toBe('stop max')
		expect(backlog_drive_cli.end_line({ reason: 'stop', token: 'stop', issue: undefined })).toBe(
			'stop',
		)
	})

	it('prints a resume line that carries every collected child', () => {
		const context = backlog_drive_cli.parse(['--owner', '4242', '--exclude', '2400', '--idle', '0'])
		const state = { ...backlog_drive.initial_state([], ACTIVE), exclude: ['2400', '2401'] }

		expect(context && backlog_drive_cli.resume_line(state, context)).toBe(
			`resume: --owner 4242 --active ${ACTIVE} --idle 0 --exclude 2400,2401`,
		)
	})
})

describe('backlog_drive_cli — a merge stop across a hand-back', () => {
	it('carries a merge stop on the resume line and reads it back', () => {
		const context = backlog_drive_cli.parse(['--owner', '4242'])
		const state = backlog_drive.merge_stopped('2401', backlog_drive.initial_state([], ACTIVE))
		const line = context && backlog_drive_cli.resume_line(state, context)

		expect(line).toBe(`resume: --owner 4242 --active ${ACTIVE} --stopped 2401`)
		expect(backlog_drive_cli.parse(['--owner', '4242', '--stopped', '2401'])?.stopped).toBe('2401')
		expect(backlog_drive_cli.parse(['--owner', '4242', '--stopped', 'x'])).toBeUndefined()
	})
})

describe('backlog_drive_cli.merge_token', () => {
	it('keeps a successful first line and a failed hand-back token', () => {
		expect(backlog_drive_cli.merge_token('2600\n', 0)).toBe('2600')
		expect(backlog_drive_cli.merge_token('retry\n', 1)).toBe('retry')
	})

	it('reads a crashed run:merge as no token rather than a collection', () => {
		const out = '[ELIFECYCLE] Command failed with exit code 1.'

		expect(backlog_drive_cli.merge_token(out, 1)).toBe('')
	})
})

it('accepts only mode without entering the backlog loop', () => {
	expect(backlog_drive_cli.parse(['--owner', '4242', '--only'])?.is_only).toBe(true)
})

// joshuafolkken/kit#3643: a `backlogrun` samples its own machine load for exactly as long as the drive
// runs — nobody starts a sampler beside it, and none is left running after it.
describe('backlog_drive_cli.run — the load sampler', () => {
	it('starts the sampler with the drive and stops it when the drive ends', async () => {
		const stop = vi.fn()
		const start = vi.spyOn(lane_sampler, 'start').mockReturnValue(stop)

		// No carry record: the drive ends at once, which is an end like any other.
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		await backlog_drive_cli.run(['--owner', '4242'])

		expect(start).toHaveBeenCalledOnce()
		expect(stop).toHaveBeenCalledOnce()
	})

	it('stops the sampler when the drive throws', async () => {
		const stop = vi.fn()

		vi.spyOn(lane_sampler, 'start').mockReturnValue(stop)
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(new Error('git died'))
		vi.spyOn(console, 'info').mockImplementation(vi.fn())

		await backlog_drive_cli.run(['--owner', '4242'])

		expect(stop).toHaveBeenCalledOnce()
	})

	it('starts no sampler for arguments it refuses', async () => {
		const start = vi.spyOn(lane_sampler, 'start')

		vi.spyOn(console, 'error').mockImplementation(vi.fn())
		await backlog_drive_cli.run(['--owner'])

		expect(start).not.toHaveBeenCalled()
	})
})

it('reports before ending the carry record', async () => {
	const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'report' })
	const error = vi.spyOn(console, 'error').mockImplementation(vi.fn())

	await backlog_drive_cli.finish({
		reason: 'stop',
		token: 'stop',
		issue: undefined,
		is_finish: true,
	})

	expect(run.mock.calls.map(([argv]) => argv)).toStrictEqual([
		['run:report'],
		['run:carry', '--end'],
	])
	run.mockRestore()
	error.mockRestore()
})

// joshuafolkken/kit#3884: a run handed to a new invocation lost every lane the previous one launched —
// the restore read only this invocation's events — so their dead units were never collected.
const PREVIOUS_RUN = {
	invocation: CARRY.invocation,
	started_at: '2026-09-22T23:00:00.000Z',
	ended_at: '2026-09-23T12:00:00.000Z',
}
const INHERITED = '3865'
const BY_HAND = '3866'

function carried_here(): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/repo/.git')
	vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: CARRY })
	vi.spyOn(run_carry_ended, 'read_ended').mockReturnValue(PREVIOUS_RUN)
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([])
	vi.spyOn(backlog_drive_named, 'reconcile').mockResolvedValue()
}

function launch_at(pos: number, issue: string, at: string): RunEvent {
	return { pos, kind: 'child-launch', text: `#${issue} dispatched`, at }
}

function lane_of(issue: string): LaneInfo {
	return { issue, is_stranded: false } as unknown as LaneInfo
}

// The launch by hand falls between the previous run's end and this one's start, so no run owns it.
it('seeds a lane the previous run launched, not one dispatched by hand between runs', async () => {
	const launches = [
		launch_at(1, INHERITED, '2026-09-23T00:00:00.000Z'),
		launch_at(2, BY_HAND, '2026-09-23T18:00:00.000Z'),
	]

	carried_here()
	vi.spyOn(run_event_stream_emit, 'all_events').mockResolvedValue(launches)
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane_of(INHERITED), lane_of(BY_HAND)])

	const context = backlog_drive_cli.parse(['--owner', '4242'])

	expect(context && (await backlog_drive_cli.seeded_lanes(context))).toStrictEqual([INHERITED])
	vi.restoreAllMocks()
})

it('keeps the window bound in the resume command', () => {
	const context = backlog_drive_cli.parse(['--owner', '4242', '--window', '9'])
	const state = backlog_drive.initial_state([], ACTIVE)

	expect(context && backlog_drive_cli.resume_line(state, context)).toContain('--window 9')
})
