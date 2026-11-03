import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'

// `git_command.push` and the base every "changed" reading is measured against, apart from
// `git-command.test.ts` so that one stays under the file limit. The fake dispatches on the command —
// `merge-base`, `rev-parse` and the diff consuming their results answer differently — keeps the whole
// call log, and fails the bare push with the exit code a test sets, which is how the 128
// `--set-upstream` fallback is reached.
const execa_mock = vi.hoisted(() => {
	const UPSTREAM_NOT_SET = 128

	return {
		UPSTREAM_NOT_SET,
		SET_UPSTREAM: '--set-upstream',
		MERGE_BASE: 'merge-base',
		MERGE_BASE_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		REV_PARSED_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		ORIGIN_HEAD_TARGET: 'refs/remotes/origin/main',
		state: {
			calls: [] as Array<Array<string>>,
			branch_name: '',
			fail_plain_push: false,
			plain_push_exit_code: UPSTREAM_NOT_SET,
			merge_base_fails: false,
			// Whether `git rev-parse --verify refs/remotes/origin/main` resolves, which is what decides
			// between the remote-tracking ref and the bare name (joshuafolkken/kit#1535).
			has_remote_ref: true,
		},
	}
})

function stdout_for(arguments_: Array<string>): string {
	if (arguments_.includes('--abbrev-ref')) return execa_mock.state.branch_name
	if (arguments_.includes('symbolic-ref')) return execa_mock.ORIGIN_HEAD_TARGET
	if (arguments_[0] === execa_mock.MERGE_BASE) return execa_mock.MERGE_BASE_SHA
	if (arguments_[0] === 'rev-parse') return execa_mock.REV_PARSED_SHA

	return ''
}

function push_failure(arguments_: Array<string>): Error | undefined {
	const is_bare_push = arguments_[0] === 'push' && !arguments_.includes(execa_mock.SET_UPSTREAM)

	if (!is_bare_push || !execa_mock.state.fail_plain_push) return undefined

	return Object.assign(new Error('bare push rejected'), {
		exitCode: execa_mock.state.plain_push_exit_code,
	})
}

function reference_fails(arguments_: Array<string>): boolean {
	if (arguments_[0] === execa_mock.MERGE_BASE) return execa_mock.state.merge_base_fails

	return arguments_.includes('--verify') && !execa_mock.state.has_remote_ref
}

async function mock_execa(_cmd: string, arguments_: Array<string>): Promise<{ stdout: string }> {
	execa_mock.state.calls.push([...arguments_])

	const push_error = push_failure(arguments_)

	if (push_error) throw push_error
	if (reference_fails(arguments_)) throw new Error('git refused')

	return { stdout: stdout_for(arguments_) }
}

vi.mock('execa', () => ({ execa: mock_execa }))

// `change_base` and the diffs never reach the hook, so mocking it leaves their readings untouched.
const hook_mock = vi.hoisted(() => ({ run: vi.fn<() => Promise<boolean>>() }))

vi.mock('./git-pre-push-hook', () => ({ git_pre_push_hook: hook_mock }))

const FEATURE_BRANCH = 'feature-branch'
const HOOK_FAILURE = 'git hook exited with code 1'
const NO_VERIFY = '--no-verify'
const DEFAULT_BRANCH = 'main'
const DEFAULT_BRANCH_REF = execa_mock.ORIGIN_HEAD_TARGET
const A_TRACKED_FILE = 'package.json'

function last_call(): Array<string> {
	return execa_mock.state.calls.at(-1) ?? []
}

beforeEach(() => {
	execa_mock.state.calls = []
	execa_mock.state.branch_name = ''
	execa_mock.state.fail_plain_push = false
	execa_mock.state.plain_push_exit_code = execa_mock.UPSTREAM_NOT_SET
	execa_mock.state.merge_base_fails = false
	execa_mock.state.has_remote_ref = true
	hook_mock.run.mockReset()
	hook_mock.run.mockResolvedValue(true)
})

describe('git_command.push', () => {
	it('falls back to --set-upstream when push fails with exit code 128', async () => {
		execa_mock.state.fail_plain_push = true
		execa_mock.state.branch_name = FEATURE_BRANCH

		await expect(git_command.push()).resolves.toBeUndefined()
	})

	it('rethrows the wrapped error when the bare push fails with a non-128 exit code', async () => {
		const NON_UPSTREAM_EXIT_CODE = 1

		execa_mock.state.fail_plain_push = true
		execa_mock.state.plain_push_exit_code = NON_UPSTREAM_EXIT_CODE

		await expect(git_command.push()).rejects.toThrow('exited with code 1')
	})
})

// joshuafolkken/kit#3300: a hook run inside the bounded push was counted against the transfer budget,
// and the lefthook and vitest it started outlived the killed `git`, so the retry ran a second unit
// suite beside the first. The hook now runs once ahead, and every bounded transfer skips it.
describe('git_command.push runs the pre-push hook outside the push budget', () => {
	it('pushes with --no-verify once the hook has run ahead', async () => {
		await git_command.push()

		expect(last_call()).toStrictEqual(['push', NO_VERIFY])
	})

	it('runs the hook once and keeps --no-verify when the push falls back to --set-upstream', async () => {
		execa_mock.state.fail_plain_push = true
		execa_mock.state.branch_name = FEATURE_BRANCH

		await git_command.push()

		expect(hook_mock.run).toHaveBeenCalledOnce()
		expect(last_call()).toStrictEqual([
			'push',
			NO_VERIFY,
			execa_mock.SET_UPSTREAM,
			'origin',
			FEATURE_BRANCH,
		])
	})

	it('leaves the hook to the push when this git cannot run it ahead', async () => {
		hook_mock.run.mockResolvedValue(false)

		await git_command.push()

		expect(last_call()).toStrictEqual(['push'])
	})

	it('does not push when the pre-push hook fails', async () => {
		hook_mock.run.mockRejectedValue(new Error(HOOK_FAILURE))

		await expect(git_command.push()).rejects.toThrow(HOOK_FAILURE)
		expect(execa_mock.state.calls).toStrictEqual([])
	})
})

describe('git_command.is_upstream_not_set_error', () => {
	const RETURNS_FALSE = 'returns false'
	const PUSH_FAILED = 'push failed'

	it('returns true for an Error with cause.exit_code of 128', () => {
		const error = new Error(PUSH_FAILED, { cause: { exit_code: '128' } })

		expect(git_command.is_upstream_not_set_error(error)).toBe(true)
	})

	it(`${RETURNS_FALSE} when cause.exit_code is not 128`, () => {
		const error = new Error(PUSH_FAILED, { cause: { exit_code: '1' } })

		expect(git_command.is_upstream_not_set_error(error)).toBe(false)
	})

	it(`${RETURNS_FALSE} for a plain Error without cause`, () => {
		expect(git_command.is_upstream_not_set_error(new Error('fail'))).toBe(false)
	})

	it(`${RETURNS_FALSE} for a non-Error value`, () => {
		expect(git_command.is_upstream_not_set_error('not an error')).toBe(false)
	})
})

// joshuafolkken/kit#1535: a lane is cut from `refs/remotes/origin/<default>`, so the base has to be
// measured against that same ref. Measured against the bare name — which git resolves to the local
// branch nothing advances — a lane cut from a remote-tracking ref three commits ahead reported
// those three commits' files as its own change.
describe('the base is the ref the lane was cut from', () => {
	it('takes the merge base against the remote-tracking ref, not the local branch', async () => {
		await git_command.change_base()

		expect(execa_mock.state.calls).toContainEqual([
			execa_mock.MERGE_BASE,
			DEFAULT_BRANCH_REF,
			'HEAD',
		])
	})

	it('resolves the same ref a lane start point does', async () => {
		await expect(git_command.default_branch_reference()).resolves.toBe(DEFAULT_BRANCH_REF)
	})

	// A fresh `git init`, or a clone whose `origin` was removed: the local branch is the only answer
	// there is, and it is the reading every caller had before.
	it('falls back to the bare name where no remote-tracking ref exists', async () => {
		execa_mock.state.has_remote_ref = false

		await git_command.change_base()

		await expect(git_command.default_branch_reference()).resolves.toBe(DEFAULT_BRANCH)
		expect(execa_mock.state.calls).toContainEqual([execa_mock.MERGE_BASE, DEFAULT_BRANCH, 'HEAD'])
	})
})

// joshuafolkken/kit#1527: a linked work tree shares the `main` ref with every other lane, so a
// two-dot `git diff main` picks up whatever another lane merged while this one was unmerged — in
// reverse. The merge base is a commit, so it does not move when the ref does.
describe('the changed-path reading measures against the merge base', () => {
	it('asks git for the merge base of the default branch and HEAD', async () => {
		await git_command.change_base()

		expect(execa_mock.state.calls).toContainEqual([
			execa_mock.MERGE_BASE,
			DEFAULT_BRANCH_REF,
			'HEAD',
		])
	})

	it('diffs the name listing against that commit rather than against the branch', async () => {
		await git_command.diff_main_names()

		expect(last_call()).toContain(execa_mock.MERGE_BASE_SHA)
		expect(last_call()).not.toContain(DEFAULT_BRANCH)
	})

	it('diffs a single file against that commit too', async () => {
		await git_command.diff_main(A_TRACKED_FILE)

		expect(last_call()).toStrictEqual(['diff', execa_mock.MERGE_BASE_SHA, '--', A_TRACKED_FILE])
	})

	// The gate stamp and the digest map have to name the same base, or a record written against one
	// reading is compared against the other.
	it('rev-parses the same base for the gate stamp', async () => {
		await expect(git_command.change_base_commit()).resolves.toBe(execa_mock.REV_PARSED_SHA)
		expect(last_call()).toStrictEqual(['rev-parse', execa_mock.MERGE_BASE_SHA])
	})

	// A repository with no common ancestor must leave the callers a reading rather than a throw:
	// every one of them treats a failure as "nothing can be reused", which is the expensive answer.
	it('falls back to the default branch when git finds no merge base', async () => {
		execa_mock.state.merge_base_fails = true

		await expect(git_command.change_base()).resolves.toBe(DEFAULT_BRANCH_REF)
	})
})
