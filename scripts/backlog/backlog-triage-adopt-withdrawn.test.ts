import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { stream } = vi.hoisted(() => ({ stream: { events: new Array<RunEvent>(), epic: 7946 } }))

vi.mock('#scripts/run/carry/run-carry', () => ({
	run_carry: {
		repository_directory: vi.fn(async () => '/repo/.git'),
		carry_path: vi.fn(() => '/repo/.git/carry'),
		read_carry: vi.fn(() => ({ kind: 'carried' })),
	},
}))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: vi.fn(async () => '[]') },
}))
vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: vi.fn(async () => []), trusted_bodies: vi.fn() },
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: vi.fn(async () => [stream.epic]) },
}))
vi.mock('#scripts/epic/epic-decide', () => ({ epic_decide: { decide: vi.fn(async () => 0) } }))
vi.mock('#scripts/run/park/run-park', () => ({ run_park: { clear: vi.fn() } }))
vi.mock('#scripts/josh/josh-run', () => ({
	josh_command: { josh_run: vi.fn(async () => await { code: 0 }) },
}))
vi.mock('#scripts/run/park/run-stalled-park', () => ({
	run_stalled_park: { apply: vi.fn(async () => true) },
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: vi.fn(async () => stream.events) },
}))
vi.mock('./backlog-triage-park-loop', () => ({
	backlog_triage_park_loop: {
		loop_of: vi.fn(() => ({ adopted: 'adopted option 1', tree: 'abc123' })),
		hold: vi.fn(async () => ({ next: 'not requeued: lane tree abc123 unchanged' })),
	},
}))

const { issue_read } = await import('#scripts/issue/issue-read')
const { josh_command } = await import('#scripts/josh/josh-run')
const { backlog_triage_park_loop } = await import('./backlog-triage-park-loop')
const { backlog_triage_cli } = await import('./backlog-triage-cli')

const ISSUE = '7945'
const PARK = [
	'## Which lane?',
	'### 選択肢',
	'1. Keep the lane',
	'   - 層: A',
	'   - 必要な権限: なし',
	'### 推奨',
	'1 cheaper',
].join('\n')

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-11-18T10:00:00.000Z' }
}

const LAUNCH = event(1, 'child-launch', '#7945 dispatched')

async function adopt(): Promise<number> {
	const argv = ['--apply', ISSUE, '--adopt', '1', '--reason', 'the parent takes it']

	return await backlog_triage_cli.run(argv, '/repo')
}

beforeEach(() => {
	stream.events = []
	vi.mocked(issue_read.trusted_bodies).mockReturnValue([PARK])
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

// joshuafolkken/kit#7983: #7945 was withdrawn at 10:36:42Z, then the 10:37:13Z adopt hit the park loop
// and wrote a PARK over the withdrawal.
describe('backlog:triage --apply --adopt — a lane a person withdrew', () => {
	it('neither holds nor requeues it, and says it was withdrawn (ac-268d0341)', async () => {
		stream.events = [
			LAUNCH,
			event(2, 'park', '#7945 parked'),
			event(3, 'withdraw', '#7945 withdrawn by a person: ships with #7951'),
		]

		await expect(adopt()).resolves.toBe(0)

		expect(backlog_triage_park_loop.hold).not.toHaveBeenCalled()
		expect(josh_command.josh_run).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('lane withdrawn'))
	})

	it('holds the park loop as before after a yield withdrew the lane (ac-d72149a7)', async () => {
		stream.events = [
			LAUNCH,
			event(2, 'note', '#7945 yielded its lane: overlaps #7951'),
			event(3, 'withdraw', '#7945 withdrawn by its own lane:plan: overlaps #7951'),
		]

		await expect(adopt()).resolves.toBe(0)

		expect(backlog_triage_park_loop.hold).toHaveBeenCalledOnce()
	})

	it('requeues as before after a yield when no park loop closes (ac-d72149a7)', async () => {
		vi.mocked(backlog_triage_park_loop.loop_of).mockReturnValueOnce(undefined)

		await expect(adopt()).resolves.toBe(0)

		expect(josh_command.josh_run).toHaveBeenCalledWith(['run:add', ISSUE, '--retry'], true)
	})
})
