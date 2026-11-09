import { rmSync } from 'node:fs'
import path from 'node:path'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_step, type StepInput } from '#scripts/run/run-step'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'
import { run_carry_cli_fixture } from './run-carry-cli-fixture'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#2342: the `run:carry --retrospective` close writes its result onto the run's event
// stream, so a run that filed zero improvements is told apart from one whose retrospective never ran.
// Colocated apart from `run-carry-cli.test.ts` to keep that file under its line ceiling — this pins the
// emit, that pins the record.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const scratch = make_directory('run-carry-cli-retro-')
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const RETROSPECTIVE = '--retrospective'
const SUMMARY = '--summary'
const ZERO_FILED = '0 filed; dropped #2240 already merged'
// A kit parent's issue at the stop position with the retrospective enabled — it owes one until marked.
const STOP_POSITION: StepInput = {
	issue_number: '6743',
	state: 'OPEN',
	is_human_review: false,
	latest_scope: 'skip',
	last_event: run_event_stream.EVENT_KIND.STOP,
	carry_kind: 'carried',
	is_retrospective_done: false,
	is_lane_child: false,
	is_consumer: false,
	is_retrospective_enabled: true,
	has_changes: false,
	has_completion_callback: true,
	is_at_cut_cap: false,
	is_handed_off: false,
	is_merge_owed: false,
}

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// The event stream `run_event_stream_emit.emit` resolves for this mocked repository — the retrospective
// close appends its result here.
function event_target(): string {
	return run_event_stream.target_of(REPOSITORY)
}

beforeEach(() => {
	run_carry_cli_fixture.hold_verdict()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	run_carry.end_carry(carry_target())
	rmSync(event_target(), { force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	rmSync(carry_target(), { force: true })
	rmSync(event_target(), { force: true })
})

describe('the retrospective result on the event stream', () => {
	// Zero filings is exactly the case that needs the record, so it is the case pinned: the close still
	// leaves one event a person can read.
	it('records the result even with zero filings', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run([RETROSPECTIVE, SUMMARY, ZERO_FILED])

		const last = run_event_stream.read_last(event_target())

		expect(last?.kind).toBe(run_event_stream.EVENT_KIND.RETROSPECTIVE)
		expect(last?.text).toBe(ZERO_FILED)
	})

	// joshuafolkken/kit#6743: the retrospective unit closes with this command, and the mark it leaves is
	// what turns the stop position's owed retrospective into `stop`.
	it('turns run:step at the stop position into stop once the close is written', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run([RETROSPECTIVE, SUMMARY, ZERO_FILED])

		const carry = run_carry.read_carry(carry_target())
		const at_stop = {
			...STOP_POSITION,
			carry_kind: carry.kind,
			is_retrospective_done: run_carry.retrospective_done_of(carry),
		}

		expect(run_step.next_action(at_stop).line).toBe(run_step.STOP)
	})

	// The unit is its own session while the parent that owns the carry is live: its close lands only
	// because it names the parent as `--owner`, which `run:handoff retrospective` puts in its brief.
	it('lands a close from another session that names the live owner, and refuses one that does not', async () => {
		const parent = String(process.pid)
		const unit = String(process.ppid)

		// No session id, so no shared transcript stands in for the owner — only the declared pid does.
		vi.stubEnv('CLAUDE_CODE_SESSION_ID', '')
		await run_carry_cli.run(['--begin', INVOCATION, '--owner', parent])
		await run_carry_cli.run([RETROSPECTIVE, SUMMARY, ZERO_FILED, '--owner', unit])
		const before = run_carry.retrospective_done_of(run_carry.read_carry(carry_target()))

		await run_carry_cli.run([RETROSPECTIVE, SUMMARY, ZERO_FILED, '--owner', parent])
		const after = run_carry.retrospective_done_of(run_carry.read_carry(carry_target()))

		expect([before, after]).toEqual([false, true])
	})

	// A refused count applied no mark, so it records no result either — the emit follows the apply.
	it('records nothing when the retrospective count is refused', async () => {
		await run_carry_cli.run([RETROSPECTIVE, SUMMARY, ZERO_FILED])

		expect(run_event_stream.read_last(event_target())).toBeUndefined()
	})
})
