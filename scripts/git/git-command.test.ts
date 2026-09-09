import { beforeEach, describe, expect, it, vi } from 'vitest'

const UPSTREAM_NOT_SET_EXIT_CODE = 128

const execa_mock = vi.hoisted(() => {
	const UPSTREAM_NOT_SET = 128
	const state = {
		should_fail: false as boolean,
		stdout: '',
		fail_plain_push: false as boolean,
		plain_push_exit_code: UPSTREAM_NOT_SET,
		// What the last call actually passed, for the assertions that care about the arguments rather
		// than the output.
		last_arguments: [] as Array<string>,
	}

	async function mock_execa(_cmd: string, arguments_: Array<string>): Promise<{ stdout: string }> {
		state.last_arguments = [...arguments_]

		const is_bare_push = arguments_[0] === 'push' && !arguments_.includes('--set-upstream')

		if (is_bare_push && state.fail_plain_push) {
			throw Object.assign(new Error('bare push rejected'), {
				exitCode: state.plain_push_exit_code,
			})
		}

		if (state.should_fail) throw new Error('Command failed')

		return { stdout: state.stdout }
	}

	return { state, mock_execa }
})

vi.mock('execa', () => ({
	execa: execa_mock.mock_execa,
}))

const PACKAGE_JSON = 'package.json'
const DIFF_OUTPUT = 'diff output'
const SUCCEEDS_TEST = 'returns a string when git succeeds'
const PROPAGATES_ERRORS_TEST = 'propagates errors instead of returning empty string'

beforeEach(() => {
	execa_mock.state.should_fail = false
	execa_mock.state.stdout = ''
	execa_mock.state.fail_plain_push = false
	execa_mock.state.plain_push_exit_code = UPSTREAM_NOT_SET_EXIT_CODE
	execa_mock.state.last_arguments = []
})

// joshuafolkken/kit#1381: every reader of this porcelain output depends on the `??` lines being there
// — `git-staging.ts` stages exactly those, and the pre-push hook reads an empty output as "this push
// carries the recorded tree". `status.showUntrackedFiles=no` in a person's git config removes them
// silently, so the flag is passed rather than inherited.
describe('the status reading names its untracked-files mode', () => {
	it('asks git for untracked files rather than inheriting the config', async () => {
		const { git_command } = await import('./git-command')

		await git_command.status()

		expect(execa_mock.state.last_arguments).toContain('--untracked-files=normal')
	})
})

// joshuafolkken/kit#907: with git's default quoting, a path containing a non-ASCII byte comes back
// C-quoted, and a classifier matching a path prefix answers no for a file it should have matched.
// `josh eval:scope` fails toward `skip` there — a change it exists to measure would go unmeasured.
describe('the path listings turn git path quoting off', () => {
	it.each(['diff_main_names', 'diff_cached_names', 'untracked_names'] as const)(
		'%s asks git for unquoted paths',
		async (name) => {
			const { git_command } = await import('./git-command')

			await git_command[name]()

			expect(execa_mock.state.last_arguments.slice(0, 2)).toStrictEqual([
				'-c',
				'core.quotePath=false',
			])
		},
	)
})

// joshuafolkken/kit#1257: `git diff --name-only` answers for the whole tree in root-relative paths,
// and `git ls-files --others` answers for the current directory in cwd-relative ones. Read from a
// subdirectory the two halves of one change therefore disagreed, and a caller joining them onto the
// repository root resolved a new file to a path that does not exist — or to a different file with
// the same tail.
describe('the diff listings pin the paths to the repository root', () => {
	it.each(['diff_main_names', 'diff_cached_names'] as const)(
		'%s asks git to ignore diff.relative',
		async (name) => {
			const { git_command } = await import('./git-command')

			await git_command[name]()

			expect(execa_mock.state.last_arguments).toContain('--no-relative')
		},
	)
})

describe('git_command.untracked_names', () => {
	it('asks for the whole tree in repository-root-relative paths', async () => {
		const { git_command } = await import('./git-command')

		await git_command.untracked_names()

		expect(execa_mock.state.last_arguments).toContain('--full-name')
		expect(execa_mock.state.last_arguments).toContain(':/')
	})
})

describe('git_command.diff_cached', () => {
	it(SUCCEEDS_TEST, async () => {
		execa_mock.state.stdout = DIFF_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.diff_cached(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		execa_mock.state.should_fail = true

		const { git_command } = await import('./git-command')

		await expect(git_command.diff_cached(PACKAGE_JSON)).rejects.toThrow()
	})
})

describe('git_command.diff_main', () => {
	it(SUCCEEDS_TEST, async () => {
		execa_mock.state.stdout = DIFF_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.diff_main(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		execa_mock.state.should_fail = true

		const { git_command } = await import('./git-command')

		await expect(git_command.diff_main(PACKAGE_JSON)).rejects.toThrow()
	})
})

const ORIGIN_MAIN_REF = 'refs/remotes/origin/main'
const NON_PREFIX_OUTPUT = 'something-else'

describe('git_command.get_default_branch', () => {
	it('returns branch name parsed from symbolic ref output', async () => {
		execa_mock.state.stdout = ORIGIN_MAIN_REF

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})

	it('returns main when symbolic ref command fails', async () => {
		execa_mock.state.should_fail = true

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})

	it('returns main when output does not start with expected prefix', async () => {
		execa_mock.state.stdout = NON_PREFIX_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})
})

describe('git_command.push', () => {
	it('falls back to --set-upstream when push fails with exit code 128', async () => {
		execa_mock.state.fail_plain_push = true
		execa_mock.state.stdout = 'feature-branch'

		const { git_command } = await import('./git-command')

		await expect(git_command.push()).resolves.toBeUndefined()
	})

	it('rethrows the wrapped error when the bare push fails with a non-128 exit code', async () => {
		const NON_UPSTREAM_EXIT_CODE = 1

		execa_mock.state.fail_plain_push = true
		execa_mock.state.plain_push_exit_code = NON_UPSTREAM_EXIT_CODE

		const { git_command } = await import('./git-command')

		await expect(git_command.push()).rejects.toThrow('exited with code 1')
	})
})

describe('git_command.is_upstream_not_set_error', () => {
	const RETURNS_FALSE = 'returns false'
	const PUSH_FAILED = 'push failed'

	it('returns true for an Error with cause.exit_code of 128', async () => {
		const { git_command } = await import('./git-command')
		const error = new Error(PUSH_FAILED, { cause: { exit_code: '128' } })

		expect(git_command.is_upstream_not_set_error(error)).toBe(true)
	})

	it(`${RETURNS_FALSE} when cause.exit_code is not 128`, async () => {
		const { git_command } = await import('./git-command')
		const error = new Error(PUSH_FAILED, { cause: { exit_code: '1' } })

		expect(git_command.is_upstream_not_set_error(error)).toBe(false)
	})

	it(`${RETURNS_FALSE} for a plain Error without cause`, async () => {
		const { git_command } = await import('./git-command')

		expect(git_command.is_upstream_not_set_error(new Error('fail'))).toBe(false)
	})

	it(`${RETURNS_FALSE} for a non-Error value`, async () => {
		const { git_command } = await import('./git-command')

		expect(git_command.is_upstream_not_set_error('not an error')).toBe(false)
	})
})

// `gh pr checkout` resolved the pull request through GraphQL and then did exactly this
// (joshuafolkken/kit#1029). Fetching the branch by name is what creates `refs/remotes/origin/<branch>`,
// which is the only reason the plain `checkout` below it can resolve a branch that is not local yet.
describe('git_command.fetch_branch', () => {
	const PR_HEAD_BRANCH = 'dependabot/npm_and_yarn/vite-7'

	// `gh pr checkout` fast-forwarded an already-local branch after its fetch; without it a repeat
	// `josh sdp <pr>` run works on the commit the previous run left behind.
	it('fast-forwards the branch onto its origin counterpart', async () => {
		const { git_command } = await import('./git-command')

		await git_command.merge_fast_forward(PR_HEAD_BRANCH)

		expect(execa_mock.state.last_arguments).toStrictEqual([
			'merge',
			'--ff-only',
			`origin/${PR_HEAD_BRANCH}`,
		])
	})

	// The destination ref is named rather than left to origin's refspec: a `--single-branch` clone —
	// which is every `actions/checkout` checkout — narrows that refspec to one branch, and a bare name
	// would then update `FETCH_HEAD` alone, leaving the checkout and the fast-forward nothing to read.
	it('fetches the named branch into its remote-tracking ref', async () => {
		const { git_command } = await import('./git-command')

		await git_command.fetch_branch(PR_HEAD_BRANCH)

		expect(execa_mock.state.last_arguments).toStrictEqual([
			'fetch',
			'origin',
			`+refs/heads/${PR_HEAD_BRANCH}:refs/remotes/origin/${PR_HEAD_BRANCH}`,
		])
	})
})

// joshuafolkken/kit#1659: `josh main:merge` needs the opposite of `merge_fast_forward`. `--ff-only`
// here would reproduce the `git pull` abort it replaced, on the diverged branch that is the only
// reason to run the command at all.
describe('git_command.merge_branch', () => {
	const DEFAULT_BRANCH = 'main'

	it('merges the branch without restricting it to a fast-forward', async () => {
		const { git_command } = await import('./git-command')

		await git_command.merge_branch(DEFAULT_BRANCH)

		expect(execa_mock.state.last_arguments).toStrictEqual(['merge', `origin/${DEFAULT_BRANCH}`])
	})
})

// joshuafolkken/kit#926: `run:preflight` needs the branch an interrupted run left, not merely whether
// one exists, so the boolean is expressed on top of the listing rather than beside it.
describe('git_command.branch_names', () => {
	const ISSUE_BRANCH_PATTERN = '926-*'
	const ISSUE_BRANCH = '926-reclaim-a-tree'

	it('asks git for the short names matching the pattern', async () => {
		const { git_command } = await import('./git-command')

		execa_mock.state.stdout = ISSUE_BRANCH

		expect(await git_command.branch_names(ISSUE_BRANCH_PATTERN)).toStrictEqual([ISSUE_BRANCH])
		expect(execa_mock.state.last_arguments).toStrictEqual([
			'branch',
			'--list',
			'--format=%(refname:short)',
			ISSUE_BRANCH_PATTERN,
		])
	})

	it('answers with nothing when git fails rather than propagating', async () => {
		const { git_command } = await import('./git-command')

		execa_mock.state.should_fail = true

		expect(await git_command.branch_names(ISSUE_BRANCH_PATTERN)).toStrictEqual([])
		expect(await git_command.branch_exists('926-x')).toBe(false)
	})

	it('reads a branch that exists as true and an empty listing as false', async () => {
		const { git_command } = await import('./git-command')

		execa_mock.state.stdout = 'main'
		expect(await git_command.branch_exists('main')).toBe(true)

		execa_mock.state.stdout = ''
		expect(await git_command.branch_exists('main')).toBe(false)
	})
})

// **`--first-parent` is what makes the count a count of pull requests.** Without it `rev-list` walks
// merges made inside a pull request branch too — "Update branch", or a local `git merge main` — and
// a release would raise the version by more minors than issues shipped (joshuafolkken/kit#1169).
const FIRST_PARENT_FLAG = '--first-parent'
const MERGE_COUNT_RANGE = 'base..HEAD'

describe('git_command.merge_count_arguments', () => {
	it('restricts the count to the branch own first-parent line', async () => {
		const { git_command } = await import('./git-command')

		expect(git_command.merge_count_arguments(MERGE_COUNT_RANGE)).toStrictEqual([
			'rev-list',
			'--count',
			'--merges',
			FIRST_PARENT_FLAG,
			MERGE_COUNT_RANGE,
		])
	})
})
