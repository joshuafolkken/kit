import { rmSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { run_preflight } from '#scripts/run/run-preflight'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

const make_directory = temporary_directory('suite')

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

vi.mock('#scripts/run/run-preflight', () => ({
	run_preflight: { CLEAN_VERDICT: 'clean', RESUME_ADVICE: 'Run the whole gate.', check: vi.fn() },
}))

vi.mock('#scripts/run/run-maintenance', () => ({ run_maintenance: { sweep: vi.fn() } }))
vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { find_open_lane: vi.fn() } }))

const scratch = make_directory('run-hold-cli-resume-test-')
const WORKTREE = path.join(scratch, '.git')
const TARGET = run_hold.hold_path(WORKTREE)
const ISSUE = '7543'
const IN_PLACE_REASON = 'HEAD is on this issue’s own branch.'

const out: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
	vi.mocked(git_command.status).mockResolvedValue('')
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(TARGET, { force: true })
})

// joshuafolkken/kit#7543: a clean verdict on the issue's own branch takes the hold, and the whole-gate
// rule its resume carries is still said rather than dropped with the reason.
describe('a clean preflight on the issue’s own branch', () => {
	it('takes the hold and still says the whole gate runs again', async () => {
		vi.mocked(run_preflight.check).mockResolvedValue({
			advice: run_preflight.RESUME_ADVICE,
			reason: IN_PLACE_REASON,
			verdict: 'clean',
		})

		await run_hold_cli.run([ISSUE])

		expect(out).toContain(run_hold_cli.HOLD_VERDICT)
		expect(errors.join('\n')).toContain(`${IN_PLACE_REASON}\n${run_preflight.RESUME_ADVICE}`)
	})

	it('prints nothing extra over a plain clean tree', async () => {
		const reason = 'Nothing was left behind.'

		vi.mocked(run_preflight.check).mockResolvedValue({
			advice: 'Start the child.',
			reason,
			verdict: 'clean',
		})

		await run_hold_cli.run([ISSUE])

		expect(out).toContain(run_hold_cli.HOLD_VERDICT)
		expect(errors.join('\n')).not.toContain(reason)
	})
})
