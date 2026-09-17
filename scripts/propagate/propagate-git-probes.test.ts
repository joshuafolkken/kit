import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { propagate_git } from './propagate-git'

// What each probe asks git, asserted without letting any of it run: two of the three talk to a
// remote, and the unit-suite network guard refuses `push` and `ls-remote` outright
// (joshuafolkken/kit#1417).
vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_git = vi.mocked(execaSync)

const CONSUMER = '/Users/example/Development/mnemecha'
const BRANCH = '295-upgrade-joshuafolkken-kit-to-1-312-0'
const BRANCH_REF = 'refs/heads/295-upgrade-joshuafolkken-kit-to-1-312-0'
const RELEASE_BRANCH = 'release/v1.2.0'
const RELEASE_BRANCH_REF = 'refs/heads/release/v1.2.0'
const MAIN = 'main'
const HEAD_SHA = '8a7ffc4e1b0d9c5a1f2e3d4c5b6a7980f1e2d3c4'
const SHORT_SHA = '8a7ffc4'
const BASE_SHA = '0011223344556677889900aabbccddeeff001122'
const SUCCESS = 0
const FAILURE = 1
const HOOKS_DIRECTORY = '.git/hooks'
const EMPTY_HOOKS_DIRECTORY = '.githooks'

// The arguments of one call, so a test can assert what git was actually asked.
function call_arguments(index: number): ReadonlyArray<string> {
	return (mocked_git.mock.calls[index]?.[1] ?? []) as ReadonlyArray<string>
}

// The options object is the third argument of the overload the probes use, which the mock's own call
// tuple does not carry a slot for.
function call_directory(index: number): string | undefined {
	const call = mocked_git.mock.calls[index] as ReadonlyArray<unknown> | undefined

	return (call?.[2] as { cwd?: string } | undefined)?.cwd
}

function answer_with(outputs: ReadonlyArray<string>): void {
	let call_index = 0

	mocked_git.mockImplementation(() => {
		const stdout = outputs[call_index] ?? ''

		call_index += 1

		return { exitCode: SUCCESS, stdout } as unknown as ReturnType<typeof execaSync>
	})
}

function refuse(): void {
	mocked_git.mockReturnValue({ exitCode: FAILURE, stdout: '' } as unknown as ReturnType<
		typeof execaSync
	>)
}

// A real directory, because the hook check is a file-system read: git names the hooks directory and
// only the file's presence decides the answer.
const state = { workspace: '', repository: '' }

beforeEach(() => {
	vi.resetAllMocks()
	state.workspace = mkdtempSync(path.join(tmpdir(), 'propagate-git-probes-'))
	state.repository = path.join(state.workspace, 'consumer')
	mkdirSync(path.join(state.repository, HOOKS_DIRECTORY), { recursive: true })
	mkdirSync(path.join(state.repository, EMPTY_HOOKS_DIRECTORY), { recursive: true })
	writeFileSync(path.join(state.repository, HOOKS_DIRECTORY, 'pre-push'), '#!/bin/sh\n')
})

afterEach(() => {
	rmSync(state.workspace, { recursive: true, force: true })
})

describe('propagate_git.commit_ahead', () => {
	it('answers the short commit when the branch carries one of its own', () => {
		answer_with([HEAD_SHA, BASE_SHA, SHORT_SHA])

		expect(propagate_git.commit_ahead(CONSUMER, MAIN)).toBe(SHORT_SHA)
	})

	// A branch created but never committed to sits on the default branch's own tip. Reading that tip
	// as a commit would report a refused push for a push nobody attempted.
	it('answers nothing when the branch still sits on the default branch tip', () => {
		answer_with([HEAD_SHA, HEAD_SHA])

		expect(propagate_git.commit_ahead(CONSUMER, MAIN)).toBeUndefined()
	})

	it('answers nothing rather than guessing when git could not be read', () => {
		refuse()

		expect(propagate_git.commit_ahead(CONSUMER, MAIN)).toBeUndefined()
	})
})

describe('propagate_git.has_remote_branch', () => {
	// Asked of the remote itself: a push that was refused leaves no remote-tracking ref behind, and
	// neither does a branch that was never pushed, so the ref cannot tell the two apart.
	//
	// The pattern is the full ref path, so that a branch pushed under a prefix — `refs/heads/wip/…`
	// is the shape that bit — can no longer answer for this one on a ref-tail match
	// (joshuafolkken/kit#1732, the same defect joshuafolkken/kit#1709 fixed in `git_worktree`).
	// Written out rather than composed from `BRANCH`, because the wire format is the subject here.
	it('asks the remote for the full ref path of the branch, not the bare name', () => {
		answer_with([`${HEAD_SHA}\trefs/heads/${BRANCH}`])
		propagate_git.has_remote_branch(CONSUMER, BRANCH)

		expect(call_arguments(0)).toEqual(['ls-remote', '--heads', 'origin', BRANCH_REF])
	})

	// A release branch name already carries a slash, which is the case the anchoring could plausibly
	// get wrong twice over: the prefix has to go on exactly once, and the result still has to exclude
	// `refs/heads/foo/release/v1.2.0`, which the bare name matched.
	it('prefixes a slash-bearing branch name exactly once', () => {
		answer_with([''])
		propagate_git.has_remote_branch(CONSUMER, RELEASE_BRANCH)

		expect(call_arguments(0)).toEqual(['ls-remote', '--heads', 'origin', RELEASE_BRANCH_REF])
	})

	it('answers true when the remote lists the branch', () => {
		answer_with([`${HEAD_SHA}\trefs/heads/${BRANCH}`])

		expect(propagate_git.has_remote_branch(CONSUMER, BRANCH)).toBe(true)
	})

	it('answers false when the remote lists nothing', () => {
		answer_with([''])

		expect(propagate_git.has_remote_branch(CONSUMER, BRANCH)).toBe(false)
	})

	it('answers false when the remote could not be reached at all', () => {
		refuse()

		expect(propagate_git.has_remote_branch(CONSUMER, BRANCH)).toBe(false)
	})
})

// `GIT_DIR` beats `cwd` and git exports it to every hook, which is how this file's own subject once
// answered about the checkout a hook was firing in rather than the consumer it was handed
// (joshuafolkken/kit#1515). A probe that lost its `cwd` would answer about the supplier.
describe('the probes ask about the consumer, not about whatever directory they run in', () => {
	it('passes the consumer path to every probe', () => {
		answer_with([HEAD_SHA, BASE_SHA, SHORT_SHA])
		propagate_git.commit_ahead(CONSUMER, MAIN)
		propagate_git.has_remote_branch(CONSUMER, BRANCH)
		propagate_git.can_push_without_hooks(CONSUMER, BRANCH)
		const directories = mocked_git.mock.calls.map((_call, index) => call_directory(index))

		expect(new Set(directories)).toEqual(new Set([CONSUMER]))
	})
})

describe('propagate_git.has_pre_push_hook', () => {
	it('honours core.hooksPath, which rev-parse --git-path does not', () => {
		answer_with([HOOKS_DIRECTORY])

		expect(propagate_git.has_pre_push_hook(state.repository)).toBe(true)
		expect(call_arguments(0)).toEqual(['config', '--get', 'core.hooksPath'])
	})

	it('falls back to the repository own hooks directory when none is configured', () => {
		answer_with(['', HOOKS_DIRECTORY])

		expect(propagate_git.has_pre_push_hook(state.repository)).toBe(true)
		expect(call_arguments(1)).toEqual(['rev-parse', '--git-path', 'hooks'])
	})

	// Without this the classification names a hook on a dry run alone, and any push failure that has
	// cleared by the time the probe runs satisfies that — in a consumer that may have no hook at all.
	it('answers false when the consumer has no pre-push hook', () => {
		answer_with([EMPTY_HOOKS_DIRECTORY])

		expect(propagate_git.has_pre_push_hook(state.repository)).toBe(false)
	})

	it('answers false rather than guessing when git could not be read', () => {
		refuse()

		expect(propagate_git.has_pre_push_hook(state.repository)).toBe(false)
	})
})

describe('propagate_git.can_push_without_hooks', () => {
	// The probe writes nothing: `--dry-run` is what keeps it read-only, and `--no-verify` is scoped
	// to it, so the consumer's own gate stays exactly as strong as it was.
	it('asks for a dry run so nothing is pushed by the probe itself', () => {
		answer_with([''])
		propagate_git.can_push_without_hooks(CONSUMER, BRANCH)

		expect(call_arguments(0)).toEqual(['push', '--dry-run', '--no-verify', 'origin', BRANCH])
	})

	it('answers true when the push would go through with the hooks out of the way', () => {
		answer_with([''])

		expect(propagate_git.can_push_without_hooks(CONSUMER, BRANCH)).toBe(true)
	})

	// The transport is what failed, not the hook — and saying otherwise sends the reader to the
	// consumer's gate for a broken network.
	it('answers false when the push would not go through even then', () => {
		refuse()

		expect(propagate_git.can_push_without_hooks(CONSUMER, BRANCH)).toBe(false)
	})
})
