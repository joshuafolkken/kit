import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_pop_cli } from '#scripts/git/stash/stash-pop-cli'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { overrides_diff_report } from '#scripts/overrides/overrides-diff-report'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_if_required_cli } from './latest-if-required-cli'
import { latest_scope_cli } from './latest-scope-cli'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const { STASH_MESSAGE } = latest_if_required_cli
const SPAWNED_LATEST = ['pnpm', ['josh', 'latest'], { stdio: 'inherit', reject: false }]
const PINS_INTACT = { is_overrides_moved: false, is_engines_moved: false }
const PIN_MOVED = 'a protected pin moved'
const LATEST_FAILED = 'josh latest failed'

function answer_scope(scope: 'required' | 'skip'): void {
	vi.spyOn(latest_scope_cli, 'scope_decision').mockReturnValue({ scope, reason: 'test reason' })
}

function latest_exits(code: number): void {
	vi.mocked(execaSync).mockReturnValue({ exitCode: code } as unknown as ReturnType<
		typeof execaSync
	>)
}

function stderr_text(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.mocked(execaSync).mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(stash_push_cli, 'set_aside').mockResolvedValue('stashed')
	vi.spyOn(stash_pop_cli, 'run').mockResolvedValue(SUCCESS_EXIT_CODE)
	vi.spyOn(git_stash, 'has_conflict').mockResolvedValue(false)
	vi.spyOn(overrides_diff_report, 'report').mockReturnValue(PINS_INTACT)
	latest_exits(SUCCESS_EXIT_CODE)
})

describe('josh latest:if-required on skip', () => {
	it('stashes nothing and runs no update', async () => {
		answer_scope('skip')

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(stash_push_cli.set_aside)).not.toHaveBeenCalled()
		expect(vi.mocked(execaSync)).not.toHaveBeenCalled()
		expect(vi.mocked(stash_pop_cli.run)).not.toHaveBeenCalled()
		expect(vi.mocked(console.info)).toHaveBeenCalledWith('skip')
	})
})

describe('josh latest:if-required on required', () => {
	it('stashes, runs josh latest, then pops the stash by its message', async () => {
		answer_scope('required')

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(stash_push_cli.set_aside)).toHaveBeenCalledWith({
			message: STASH_MESSAGE,
			dir: undefined,
		})
		expect(vi.mocked(execaSync)).toHaveBeenCalledWith(...SPAWNED_LATEST)
		expect(vi.mocked(stash_pop_cli.run)).toHaveBeenCalledWith([STASH_MESSAGE])
	})

	it('runs the stash, the update and the pop in that order', async () => {
		answer_scope('required')

		await latest_if_required_cli.run([])

		const [stashed = Infinity] = vi.mocked(stash_push_cli.set_aside).mock.invocationCallOrder
		const [updated = Infinity] = vi.mocked(execaSync).mock.invocationCallOrder
		const [popped = Infinity] = vi.mocked(stash_pop_cli.run).mock.invocationCallOrder

		expect(stashed).toBeLessThan(updated)
		expect(updated).toBeLessThan(popped)
	})

	it('runs josh latest without a pop when the tree had nothing to stash', async () => {
		answer_scope('required')
		vi.mocked(stash_push_cli.set_aside).mockResolvedValue('clean')

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(execaSync)).toHaveBeenCalledTimes(1)
		expect(vi.mocked(stash_pop_cli.run)).not.toHaveBeenCalled()
	})
})

describe('josh latest:if-required prints the dependency-update check', () => {
	it('checks the pins against HEAD after the update and before the pop', async () => {
		answer_scope('required')

		await latest_if_required_cli.run([])

		const [updated = Infinity] = vi.mocked(execaSync).mock.invocationCallOrder
		const [checked = Infinity] = vi.mocked(overrides_diff_report.report).mock.invocationCallOrder
		const [popped = Infinity] = vi.mocked(stash_pop_cli.run).mock.invocationCallOrder

		expect(vi.mocked(overrides_diff_report.report)).toHaveBeenCalledWith('HEAD')
		expect(updated).toBeLessThan(checked)
		expect(checked).toBeLessThan(popped)
	})

	it('does not check the pins when josh latest fails', async () => {
		answer_scope('required')
		latest_exits(FAILURE_EXIT_CODE)

		await latest_if_required_cli.run([])

		expect(vi.mocked(overrides_diff_report.report)).not.toHaveBeenCalled()
	})
})

describe('josh latest:if-required answers the dependency-update check', () => {
	it('names the one item no command judges when the pins are intact', async () => {
		answer_scope('required')

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			expect.stringContaining('judge: the devDependencies of overridden packages'),
		)
	})

	it.each([
		['an override', { is_overrides_moved: true, is_engines_moved: false }],
		['devEngines', { is_overrides_moved: false, is_engines_moved: true }],
	])('stops after the pop when %s moved', async (_label, verdict) => {
		answer_scope('required')
		vi.mocked(overrides_diff_report.report).mockReturnValue(verdict)

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(stash_pop_cli.run)).toHaveBeenCalledWith([STASH_MESSAGE])
		expect(stderr_text()).toContain(`${PIN_MOVED} — restore it and ask`)
	})

	it('stops when HEAD resolves to nothing to check against', async () => {
		answer_scope('required')
		vi.mocked(overrides_diff_report.report).mockReturnValue(undefined)

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(stderr_text()).toContain(PIN_MOVED)
	})
})

// joshuafolkken/kit#7148: `josh latest` exits on its own code when the overrides moved — a full
// update, so the stash is popped and the check stops, rather than a failed update.
describe('josh latest:if-required on josh latest exiting on moved overrides', () => {
	it('pops the stash and stops on the moved-pin answer', async () => {
		answer_scope('required')
		latest_exits(latest_scope_cli.OVERRIDES_MOVED_EXIT_CODE)
		vi.mocked(overrides_diff_report.report).mockReturnValue({
			is_overrides_moved: true,
			is_engines_moved: false,
		})

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(stash_pop_cli.run)).toHaveBeenCalledWith([STASH_MESSAGE])
		expect(stderr_text()).toContain(PIN_MOVED)
		expect(stderr_text()).not.toContain(LATEST_FAILED)
	})
})

describe('josh latest:if-required stops with the stash kept', () => {
	it('stops and names the stash when the pop conflicts', async () => {
		answer_scope('required')
		vi.mocked(git_stash.has_conflict).mockResolvedValue(true)

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(stderr_text()).toContain('the pop conflicted')
		expect(stderr_text()).toContain(`"${STASH_MESSAGE}" is applied and still kept`)
		expect(stderr_text()).not.toContain('pnpm josh stash:pop')
	})

	it('stops when the pop itself fails', async () => {
		answer_scope('required')
		vi.mocked(stash_pop_cli.run).mockResolvedValue(FAILURE_EXIT_CODE)

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(stderr_text()).toContain('the pop failed')
	})

	it('does not pop when josh latest fails', async () => {
		answer_scope('required')
		latest_exits(FAILURE_EXIT_CODE)

		const code = await latest_if_required_cli.run([])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(stash_pop_cli.run)).not.toHaveBeenCalled()
		expect(stderr_text()).toContain(LATEST_FAILED)
	})
})

describe('josh latest:if-required arguments', () => {
	it('refuses any argument before deciding anything', async () => {
		const decide = vi.spyOn(latest_scope_cli, 'scope_decision')

		const code = await latest_if_required_cli.run(['--force'])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(decide).not.toHaveBeenCalled()
	})
})
