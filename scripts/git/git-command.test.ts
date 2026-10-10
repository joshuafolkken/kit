import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_mock = vi.hoisted(() => {
	const state = {
		should_fail: false as boolean,
		stdout: '',
		// What the last call actually passed, for the assertions that care about the arguments rather
		// than the output.
		last_arguments: [] as Array<string>,
		last_options: undefined as unknown,
	}

	async function mock_execa(
		_cmd: string,
		arguments_: Array<string>,
		options?: unknown,
	): Promise<{ stdout: string }> {
		state.last_arguments = [...arguments_]
		state.last_options = options

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
	execa_mock.state.last_arguments = []
	execa_mock.state.last_options = undefined
})

// joshuafolkken/kit#1381: every reader of this porcelain output depends on the `??` lines being there
// — `git-staging.ts` stages exactly those, and the pre-push hook reads an empty output as "this push
// carries the recorded tree". `status.showUntrackedFiles=no` in a person's git config removes them
// silently, so the flag is passed rather than inherited.
describe('the status reading names its untracked-files mode', () => {
	it('asks git for untracked files rather than inheriting the config', async () => {
		const { git_command } = await import('./git-command')

		await git_command.status()

		expect(execa_mock.state.last_arguments).toContain('--untracked-files=all')
	})
})

// joshuafolkken/kit#2855: the preflight asks a lane's work tree whether it holds uncommitted work, so a
// directory that never reached git would read this tree in its place and miss the lane's changes.
describe('the status reading targets another work tree when given its directory', () => {
	it('runs git status inside the named directory', async () => {
		const { git_command } = await import('./git-command')
		const lane_directory = '/repo/.repo-lanes/926'

		await git_command.status(lane_directory)

		expect(execa_mock.state.last_arguments.slice(0, 3)).toEqual(['-C', lane_directory, 'status'])
	})
})

// joshuafolkken/kit#907: with git's default quoting, a path containing a non-ASCII byte comes back
// C-quoted, and a classifier matching a path prefix answers no for a file it should have matched.
// `josh review:level` reads these same paths, so a dropped match would misjudge the review depth.
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

	// joshuafolkken/kit#2462: no `+`, so a local branch that diverged is refused rather than rewritten.
	it('fast-forwards a branch that is not checked out without a forced update', async () => {
		const { git_command } = await import('./git-command')

		await git_command.fast_forward_local('main')

		expect(execa_mock.state.last_arguments).toStrictEqual(['fetch', 'origin', 'main:main'])
	})

	// joshuafolkken/kit#3590: a plain read is bounded as a local command, far too short for a transfer.
	it('bounds both fetches with the remote budget', async () => {
		const { git_command } = await import('./git-command')
		const { PUSH_TIMEOUT_MS } = await import('./git-push-transport')

		await git_command.fetch_branch(PR_HEAD_BRANCH)
		const fetch_options = execa_mock.state.last_options

		await git_command.fast_forward_local('main')

		expect(fetch_options).toMatchObject({ timeout: PUSH_TIMEOUT_MS })
		expect(execa_mock.state.last_options).toMatchObject({ timeout: PUSH_TIMEOUT_MS })
	})
})

// joshuafolkken/kit#3590: `git_spawn.with_output` defaults to a local command's budget, which would
// end a commit or a merge inside the hooks it runs — `pre-commit`'s type check among them.
describe('the git commands that run hooks', () => {
	it('gives a commit the budget of a suite', async () => {
		const { git_command } = await import('./git-command')

		await git_command.commit('Bound the probes #3590')

		expect(execa_mock.state.last_options).toMatchObject({ timeout: SUITE_TIMEOUT_MS })
	})

	it('gives a merge the budget of a suite', async () => {
		const { git_command } = await import('./git-command')

		await git_command.merge_branch('main')

		expect(execa_mock.state.last_options).toMatchObject({ timeout: SUITE_TIMEOUT_MS })
	})

	// `post-checkout` and `post-merge` are a consumer's to fill — with a `pnpm install`, often.
	it.each(['checkout', 'checkout_b', 'merge_fast_forward'] as const)(
		'gives %s the budget of a suite',
		async (command) => {
			const { git_command } = await import('./git-command')

			await git_command[command]('3590-lane')

			expect(execa_mock.state.last_options).toMatchObject({ timeout: SUITE_TIMEOUT_MS })
		},
	)
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

	// joshuafolkken/kit#2439: git's default merge message has no `#N`, which the commit-msg hook refuses.
	it('passes a merge message ahead of the branch when one is given', async () => {
		const { git_command } = await import('./git-command')
		const message = 'Merge main into 2421-lane #2421'

		await git_command.merge_branch(DEFAULT_BRANCH, message)

		expect(execa_mock.state.last_arguments).toStrictEqual([
			'merge',
			'-m',
			message,
			`origin/${DEFAULT_BRANCH}`,
		])
	})

	// joshuafolkken/kit#3517: git reads `-c` only ahead of the command name.
	it('puts config options ahead of the merge command', async () => {
		const { git_command } = await import('./git-command')
		const options = ['-c', 'merge.example.driver=true']

		await git_command.merge_branch(DEFAULT_BRANCH, undefined, options)

		expect(execa_mock.state.last_arguments).toStrictEqual([
			...options,
			'merge',
			`origin/${DEFAULT_BRANCH}`,
		])
	})
})

// joshuafolkken/kit#1683: the pull left behind when joshuafolkken/kit#1659 fixed `josh main:merge`.
// A bare `git pull` with neither `pull.rebase` nor `pull.ff` set aborts on a diverged branch, so the
// strategy is passed rather than inherited — and it is `--ff-only`, because every caller is on the
// default branch bringing it up to date and none of them is asking to absorb divergence.
describe('git_command.pull_fast_forward', () => {
	it('names the reconcile strategy rather than inheriting it from the git configuration', async () => {
		const { git_command } = await import('./git-command')

		await git_command.pull_fast_forward()

		expect(execa_mock.state.last_arguments).toStrictEqual(['pull', '--ff-only'])
	})

	// joshuafolkken/kit#2942: `josh main:sync` pulls through this, and an unbounded network call there
	// waited 37 minutes on a dead connection while the backlog driver stood behind it.
	it('bounds the pull with the remote budget', async () => {
		const { git_command } = await import('./git-command')
		const { PUSH_TIMEOUT_MS } = await import('./git-push-transport')

		await git_command.pull_fast_forward()

		expect(execa_mock.state.last_options).toMatchObject({ timeout: PUSH_TIMEOUT_MS })
	})
})

// joshuafolkken/kit#926: `run:hold`'s preflight check needs the branch an interrupted run left, not merely whether
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
