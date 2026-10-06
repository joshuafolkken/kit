import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { run_label } from '#scripts/run/run-label'
import { run_preflight } from '#scripts/run/run-preflight'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

// The release half of `run-hold-cli.test.ts`, split out when that file reached its 300-code-line
// limit (joshuafolkken/kit#3182): the refusals, the forced release and the `in-progress` strip.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

vi.mock('#scripts/run/run-preflight', () => ({
	run_preflight: { CLEAN_VERDICT: 'clean', check: vi.fn() },
}))

vi.mock('#scripts/run/tidy/run-tidy-cli', () => ({ run_tidy_cli: { sweep: vi.fn() } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const unmark = vi.mocked(run_label.unmark)
const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-cli-release-test-'))
const WORKTREE = path.join(scratch, '.git')
const ISSUE = '1091'
const OTHER_ISSUE = '1090'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const out: Array<string> = []
const errors: Array<string> = []

function reset_output(): void {
	out.length = 0
	errors.length = 0
}

beforeEach(() => {
	reset_output()
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
	vi.mocked(git_command.status).mockResolvedValue('')
	vi.mocked(run_preflight.check).mockResolvedValue({ advice: '', reason: '', verdict: 'clean' })
	unmark.mockResolvedValue(true)
})

afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	rmSync(run_hold.hold_path(WORKTREE), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#3182: the manifests stripped the label by hand at every stop that released.
describe('a numbered release takes the in-progress label off its own issue', () => {
	it('strips the label when it releases its own record', async () => {
		await run_hold_cli.run([ISSUE])

		expect(await run_hold_cli.run(['--release', ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect(unmark).toHaveBeenCalledExactlyOnceWith(ISSUE)
	})

	it('strips the label even when no record was left to remove', async () => {
		await run_hold_cli.run(['--release', ISSUE])

		expect(out).toEqual([run_hold_cli.NONE_VERDICT])
		expect(unmark).toHaveBeenCalledExactlyOnceWith(ISSUE)
	})

	it('touches no label on an unnumbered release, which names no issue', async () => {
		await run_hold_cli.run(['--release'])

		expect(unmark).not.toHaveBeenCalled()
	})

	it('keeps its verdict when the strip fails', async () => {
		unmark.mockResolvedValue(false)

		expect(await run_hold_cli.run(['--release', ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.NONE_VERDICT])
	})
})

// joshuafolkken/kit#1799: the record carried no owner, so this command removed whatever was there —
// and the `busy` stop message is what sends a person here to clear a record they judged stale from
// outside the run that wrote it.
describe('releasing a record another run wrote', () => {
	beforeEach(async () => {
		await run_hold_cli.run([ISSUE])
		reset_output()
	})

	it('answers held and exits non-zero', async () => {
		expect(await run_hold_cli.run(['--release', OTHER_ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.HELD_VERDICT])
	})

	it('leaves the record and both issues’ labels in place', async () => {
		await run_hold_cli.run(['--release', OTHER_ISSUE])

		const read = run_hold.read_hold(run_hold.hold_path(WORKTREE))

		expect(read.kind === 'held' ? read.hold.issue : undefined).toBe(ISSUE)
		expect(unmark).not.toHaveBeenCalled()
	})

	it('names both ways forward on standard error', async () => {
		await run_hold_cli.run(['--release', OTHER_ISSUE])

		expect(errors.join('\n')).toContain(run_hold.own_release_command(ISSUE))
		expect(errors.join('\n')).toContain(run_hold.FORCE_RELEASE_COMMAND)
	})

	// The bare spelling is the unnumbered run's own release, so it is a claimant like any other.
	it('refuses a bare release while a numbered run holds the tree', async () => {
		await run_hold_cli.run(['--release'])

		expect(out).toEqual([run_hold_cli.HELD_VERDICT])
	})
})

// A record nothing can parse names no run, so no claimant matches it — and removing it anyway is the
// one thing this path exists to refuse.
describe('releasing a record that cannot be read', () => {
	it('answers unknown and removes nothing', async () => {
		vi.spyOn(run_hold, 'read_hold').mockReturnValue({ kind: 'unreadable' })
		const removed = vi.spyOn(run_hold, 'release_hold')

		expect(await run_hold_cli.run(['--release', ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.UNKNOWN_VERDICT])
		expect(removed).not.toHaveBeenCalled()
		expect(unmark).not.toHaveBeenCalled()
	})
})

// The one path that removes a record without matching it: a session that crashed leaves no run
// behind to release its own record, and an expired one over a dirty tree never frees itself.
describe('a forced release', () => {
	it('removes a record another run wrote, leaving that run’s label alone', async () => {
		await run_hold_cli.run([ISSUE])
		reset_output()

		expect(await run_hold_cli.run(['--release', '--force'])).toBe(SUCCESS_EXIT_CODE)
		expect(out).toEqual([run_hold_cli.RELEASED_VERDICT])
		expect(run_hold.read_hold(run_hold.hold_path(WORKTREE)).kind).toBe('free')
		expect(unmark).not.toHaveBeenCalled()
	})

	it('says whose record it removed', async () => {
		await run_hold_cli.run([ISSUE])
		reset_output()

		await run_hold_cli.run(['--release', '--force'])

		expect(errors.join('\n')).toContain(`#${ISSUE}`)
	})

	it('answers none when nothing held the tree', async () => {
		await run_hold_cli.run(['--release', '--force'])

		expect(out).toEqual([run_hold_cli.NONE_VERDICT])
	})
})
