import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_checks, WATCH_FAILED_NOTE } from './git-pr-followup'

// joshuafolkken/kit#999: the watch fails when **any** check has failed, CodeRabbit included, and
// `run_checks` let that escape. On a pull request whose checks all finished
// inside the two-minute window with only CodeRabbit red, `followup` therefore died before
// `evaluate_pr_state` could apply kit#753's exemption at all — invisible on a slower suite, where the
// watch times out first. The watch is a look ahead, not a gate.
//
// A separate suite from `git-pr-followup.test.ts` because `run_checks` needs only these two
// collaborators, and the file it came from was already at its length limit.

vi.mock('./git-gh-command', () => ({
	git_gh_command: { pr_checks_watch: vi.fn(), pr_get_state_snapshot: vi.fn() },
}))

vi.mock('./git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
}))

const { git_gh_command } = await import('./git-gh-command')
const { git_pr_checks } = await import('./git-pr-checks')

const BRANCH_NAME = 'test-branch'
const WATCH_EXIT_ONE = 'gh api reported a failing check on the branch: CodeRabbit'
const EVALUATOR_FAILURE = 'PR checks failed (failed checks: E2E).'
const SNAPSHOT = { rollup: [], merge_state_status: undefined, review_decision: undefined }

const watch = vi.mocked(git_gh_command.pr_checks_watch)
const wait = vi.mocked(git_pr_checks.wait_for_pr_success)
const fetch_state = vi.mocked(git_gh_command.pr_get_state_snapshot)
// The raw `gh pr view` payload, which is what the guard reads — the parsed snapshot cannot answer
// the question, because it degrades an unreadable answer to the same empty rollup.
const WITH_A_CHECK = JSON.stringify({
	statusCheckRollup: [{ name: 'CodeRabbit', conclusion: 'FAILURE' }],
})
const WITH_NO_CHECKS = JSON.stringify({ statusCheckRollup: [] })

function watch_fails(): void {
	watch.mockRejectedValue(new Error(WATCH_EXIT_ONE))
}

async function run_with_watch(is_skip_watch = false): Promise<unknown> {
	return await run_checks({ branch_name: BRANCH_NAME, is_skip_watch })
}

beforeEach(() => {
	vi.clearAllMocks()
	watch.mockReset()
	wait.mockReset()
	wait.mockResolvedValue(SNAPSHOT)
	fetch_state.mockReset()
	fetch_state.mockResolvedValue(WITH_A_CHECK)
})

describe('run_checks — the watch never decides the outcome', () => {
	it('reaches the evaluator when the watch exits non-zero', async () => {
		watch_fails()

		await expect(run_with_watch()).resolves.toStrictEqual(SNAPSHOT)
		expect(wait).toHaveBeenCalledWith(BRANCH_NAME)
	})

	it('still reaches the evaluator when the watch succeeds', async () => {
		watch.mockResolvedValue({ timed_out: false })

		await expect(run_with_watch()).resolves.toStrictEqual(SNAPSHOT)
	})

	// `--skip-watch` must not start one, and must still poll.
	it('skips the watch but still polls when asked to', async () => {
		await expect(run_with_watch(true)).resolves.toStrictEqual(SNAPSHOT)
		expect(watch).not.toHaveBeenCalled()
	})
})

describe('run_checks — the swallowed failure stays visible', () => {
	// Swallowing it silently would hide the reason a run used to stop here.
	it('says the watch failed and that it fell through', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		watch_fails()
		await run_with_watch()

		const said = info.mock.calls.flat().join('\n')

		info.mockRestore()
		expect(said).toContain(WATCH_FAILED_NOTE)
	})

	// The evaluator is what ends the wait on a real failure, so falling through costs no time:
	// kit#990's fast-fail acts on the first poll, not on this exit code.
	it('lets the evaluator decide a failure rather than the watch', async () => {
		watch_fails()
		wait.mockRejectedValue(new Error(EVALUATOR_FAILURE))

		await expect(run_with_watch()).rejects.toThrow('failed checks: E2E')
	})
})

// The watch fails both for "a check failed" and for "no checks reported", and `run_checks` does not
// read its message — only the pull request's own rollup separates them.
// Falling through on an empty one would trade a failure reported in seconds for the whole 32-minute
// budget spent on a required check that is missing rather than pending.
describe('run_checks — a pull request with no checks still fails fast', () => {
	it('rethrows the watch failure when the pull request has no checks', async () => {
		watch_fails()
		fetch_state.mockResolvedValue(WITH_NO_CHECKS)

		await expect(run_with_watch()).rejects.toThrow(WATCH_EXIT_ONE)
		expect(wait).not.toHaveBeenCalled()
	})

	it('falls through when the pull request does have checks', async () => {
		watch_fails()

		await expect(run_with_watch()).resolves.toStrictEqual(SNAPSHOT)
		expect(wait).toHaveBeenCalledWith(BRANCH_NAME)
	})

	// The read refines the swallow; it is not a gate of its own, so a read that fails must not turn
	// into a second way for the watch to end the run.
	it('falls through when the check read itself fails', async () => {
		watch_fails()
		fetch_state.mockRejectedValue(new Error('gh unavailable'))

		await expect(run_with_watch()).resolves.toStrictEqual(SNAPSHOT)
	})
})

// The parsed snapshot degrades a malformed answer to an empty rollup, so reading emptiness from it
// would put an unreadable payload back on the path this change exists to remove. Only a payload that
// definitely says "no checks" may rethrow; everything else falls through.
describe('run_checks — only a definite empty rollup may rethrow', () => {
	it.each([
		['an unreadable payload', 'not json'],
		['a payload that is not an object', '"a string"'],
		['a payload with no rollup field', JSON.stringify({ mergeStateStatus: 'CLEAN' })],
		['a rollup that is not an array', JSON.stringify({ statusCheckRollup: 'nope' })],
	])('falls through for %s', async (_case, raw) => {
		watch_fails()
		fetch_state.mockResolvedValue(raw)

		await expect(run_with_watch()).resolves.toStrictEqual(SNAPSHOT)
	})

	// The read throws rather than answering, so an unreachable pull request falls through too.
	it('falls through when the read throws', async () => {
		watch_fails()
		fetch_state.mockRejectedValue(new Error('no pull requests found'))

		await expect(run_with_watch()).resolves.toStrictEqual(SNAPSHOT)
	})

	// A successful watch must not spend the extra read at all.
	it('spends no extra read when the watch succeeded', async () => {
		watch.mockResolvedValue({ timed_out: false })

		await run_with_watch()

		expect(fetch_state).not.toHaveBeenCalled()
	})
})
