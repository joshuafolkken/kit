import { josh_command } from '#scripts/josh/josh-run'
import type { RunCarry } from '#scripts/run/run-carry'
import { describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_cli } from './backlog-drive-cli'

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
		})
	})
})

it.each([
	[[]],
	[['--owner', 'abc']],
	[['--owner', '1', '--exclude', '2400,--evil']],
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
			'2400',
			'--idle',
			'0',
		])
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

it('keeps the window bound in the resume command', () => {
	const context = backlog_drive_cli.parse(['--owner', '4242', '--window', '9'])
	const state = backlog_drive.initial_state([], ACTIVE)

	expect(context && backlog_drive_cli.resume_line(state, context)).toContain('--window 9')
})
