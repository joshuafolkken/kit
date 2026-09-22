import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'
import { run_event_stream } from './run-event-stream'

// joshuafolkken/kit#2342: the `run:carry --retrospective` close writes its result onto the run's event
// stream, so a run that filed zero improvements is told apart from one whose retrospective never ran.
// Colocated apart from `run-carry-cli.test.ts` to keep that file under its line ceiling — this pins the
// emit, that pins the record.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-cli-retro-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const RETROSPECTIVE = '--retrospective'
const SUMMARY = '--summary'
const ZERO_FILED = '0 filed; dropped #2240 already merged'

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// The event stream `run_event_stream_emit.emit` resolves for this mocked repository — the retrospective
// close appends its result here.
function event_target(): string {
	return run_event_stream.target_of(REPOSITORY)
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	run_carry.end_carry(carry_target())
	rmSync(event_target(), { force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(carry_target(), { force: true })
	rmSync(event_target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
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

	// A refused count applied no mark, so it records no result either — the emit follows the apply.
	it('records nothing when the retrospective count is refused', async () => {
		await run_carry_cli.run([RETROSPECTIVE, SUMMARY, ZERO_FILED])

		expect(run_event_stream.read_last(event_target())).toBeUndefined()
	})
})
