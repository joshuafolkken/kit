import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1527: the base every "changed" reading is measured against.
//
// **The execa mock next door is not reusable here, and copying it is not what this is.** That one
// answers every command with one `stdout` and remembers only the *last* call — which is all its
// assertions need. This reading spawns two commands whose outputs differ (`merge-base`, then the
// diff that consumes its result), so the mock has to dispatch on the command and keep the whole
// call log. Extending the shared one instead would rewrite a mock forty-odd passing tests depend on,
// to no benefit for any of them.
const execa_mock = vi.hoisted(() => {
	const MERGE_BASE = 'merge-base'
	const MERGE_BASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	const REV_PARSED_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

	const state = {
		calls: [] as Array<Array<string>>,
		merge_base_fails: false as boolean,
	}

	function stdout_for(arguments_: Array<string>): string {
		if (arguments_.includes('symbolic-ref')) return 'refs/remotes/origin/main'
		if (arguments_[0] === MERGE_BASE) return MERGE_BASE_SHA
		if (arguments_[0] === 'rev-parse') return REV_PARSED_SHA

		return ''
	}

	async function mock_execa(_cmd: string, arguments_: Array<string>): Promise<{ stdout: string }> {
		state.calls.push([...arguments_])

		if (arguments_[0] === MERGE_BASE && state.merge_base_fails) throw new Error('no merge base')

		return { stdout: stdout_for(arguments_) }
	}

	return { state, mock_execa, MERGE_BASE, MERGE_BASE_SHA, REV_PARSED_SHA }
})

vi.mock('execa', () => ({ execa: execa_mock.mock_execa }))

const DEFAULT_BRANCH = 'main'
const A_TRACKED_FILE = 'package.json'

function last_call(): Array<string> {
	return execa_mock.state.calls.at(-1) ?? []
}

beforeEach(() => {
	execa_mock.state.calls = []
	execa_mock.state.merge_base_fails = false
})

// A linked work tree shares the `main` ref with every other lane, so a two-dot `git diff main`
// picks up whatever another lane merged while this one was unmerged — in reverse. The merge base is
// a commit, so it does not move when the ref does.
describe('the changed-path reading measures against the merge base', () => {
	it('asks git for the merge base of the default branch and HEAD', async () => {
		const { git_command } = await import('./git-command')

		await git_command.change_base()

		expect(execa_mock.state.calls).toContainEqual([execa_mock.MERGE_BASE, DEFAULT_BRANCH, 'HEAD'])
	})

	it('diffs the name listing against that commit rather than against the branch', async () => {
		const { git_command } = await import('./git-command')

		await git_command.diff_main_names()

		expect(last_call()).toContain(execa_mock.MERGE_BASE_SHA)
		expect(last_call()).not.toContain(DEFAULT_BRANCH)
	})

	it('diffs a single file against that commit too', async () => {
		const { git_command } = await import('./git-command')

		await git_command.diff_main(A_TRACKED_FILE)

		expect(last_call()).toStrictEqual(['diff', execa_mock.MERGE_BASE_SHA, '--', A_TRACKED_FILE])
	})

	// The gate stamp and the digest map have to name the same base, or a record written against one
	// reading is compared against the other.
	it('rev-parses the same base for the gate stamp', async () => {
		const { git_command } = await import('./git-command')

		await expect(git_command.change_base_commit()).resolves.toBe(execa_mock.REV_PARSED_SHA)
		expect(last_call()).toStrictEqual(['rev-parse', execa_mock.MERGE_BASE_SHA])
	})

	// A repository with no common ancestor must leave the callers a reading rather than a throw:
	// every one of them treats a failure as "nothing can be reused", which is the expensive answer.
	it('falls back to the default branch when git finds no merge base', async () => {
		execa_mock.state.merge_base_fails = true

		const { git_command } = await import('./git-command')

		await expect(git_command.change_base()).resolves.toBe(DEFAULT_BRANCH)
	})
})
