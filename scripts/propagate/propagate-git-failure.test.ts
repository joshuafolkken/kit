import { beforeEach, describe, expect, it, vi } from 'vitest'
import { propagate_git } from './propagate-git'
import { propagate_git_failure, type GitStepState } from './propagate-git-failure'

// The probes are replaced rather than run: two of them talk to a remote, and the unit-suite network
// guard refuses `push`, `ls-remote` and `remote` outright — "mock the read instead" is its own
// instruction. What each probe asks git is asserted in `propagate-git-probes.test.ts`.
vi.mock('./propagate-git', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	propagate_git: {
		default_branch: vi.fn(),
		current_branch: vi.fn(),
		commit_ahead: vi.fn(),
		has_remote_branch: vi.fn(),
		has_pre_push_hook: vi.fn(),
		can_push_without_hooks: vi.fn(),
		is_clean: vi.fn(),
	},
}))

const BRANCH = '295-upgrade-joshuafolkken-kit-to-1-312-0'
const SHA = '8a7ffc4'
const MAIN = 'main'
const CONSUMER = '/Users/example/Development/mnemecha'
const EXIT_ONE = 'exit 1'
const PR_STEP = 'josh git'
const AUDIT_LINE = '🥊 audit'
const INSTALL_LINE = 'pnpm install'
const REFUSAL = 'error: failed to push some refs'
const UNIT_LINE = '✔️ test-unit'
const E2E_LINE = '✔️ test-e2e'
const TAIL_LABEL = 'last output: '
// Built from the code point rather than written out: the escape byte is invisible in the source, so
// a literal reads to a spell check as one word glued to the escape sequence in front of it.
const ESCAPE_CODE_POINT = 27
const ESCAPE = String.fromCodePoint(ESCAPE_CODE_POINT)
const RED = `${ESCAPE}[31m`
const RESET = `${ESCAPE}[39m`
const HOOK_STDOUT = [UNIT_LINE, E2E_LINE, AUDIT_LINE].join('\n')
const HOOK_STDERR = ['pre-push hook declined', REFUSAL].join('\n')
const HOOK_STREAMS = [HOOK_STDOUT, HOOK_STDERR]

function on_default_branch(): GitStepState {
	return {
		branch: undefined,
		head_commit: undefined,
		is_tree_clean: false,
		is_on_remote: false,
		is_push_hook_blocked: false,
	}
}

function branch_without_commit(): GitStepState {
	return {
		branch: BRANCH,
		head_commit: undefined,
		is_tree_clean: false,
		is_on_remote: false,
		is_push_hook_blocked: false,
	}
}

function hook_refused(): GitStepState {
	return {
		branch: BRANCH,
		head_commit: SHA,
		is_tree_clean: false,
		is_on_remote: false,
		is_push_hook_blocked: true,
	}
}

function push_never_landed(): GitStepState {
	return {
		branch: BRANCH,
		head_commit: SHA,
		is_tree_clean: true,
		is_on_remote: false,
		is_push_hook_blocked: false,
	}
}

function pushed_but_no_pull_request(): GitStepState {
	return {
		branch: BRANCH,
		head_commit: SHA,
		is_tree_clean: true,
		is_on_remote: true,
		is_push_hook_blocked: false,
	}
}

// The defect this file exists for: `josh git` returns one exit code for staging, committing, pushing
// and opening the pull request alike, and the run reported every one of them as changes the upgrade
// and the sync had left uncommitted (joshuafolkken/kit#1417).
describe('propagate_git_failure.describe_failure', () => {
	it('reports a checkout still on its default branch as nothing committed', () => {
		expect(propagate_git_failure.describe_failure(on_default_branch())).toBe(
			propagate_git_failure.NO_COMMIT,
		)
	})

	// A branch created but never committed to sits on the default branch's own tip, and reading that
	// tip as a commit would report a refused push for a push nobody attempted.
	it('reports a branch carrying no commit of its own as nothing committed', () => {
		expect(propagate_git_failure.describe_failure(branch_without_commit())).toBe(
			propagate_git_failure.NO_COMMIT,
		)
	})

	it('names the pre-push hook when the commit was made and only the hook stood in the way', () => {
		const detail = propagate_git_failure.describe_failure(hook_refused())

		expect(detail).toContain(propagate_git_failure.HOOK_REFUSED)
		expect(detail).toContain(SHA)
		expect(detail).toContain(BRANCH)
	})

	// The same local state as above, so only the corroborating probes separate them. Reporting a
	// transport failure as a hook refusal sends the reader to a gate that may not even exist.
	it('does not blame the hook when the push itself could not go through either', () => {
		const detail = propagate_git_failure.describe_failure(push_never_landed())

		expect(detail).toContain(propagate_git_failure.PUSH_FAILED)
		expect(detail).not.toContain(propagate_git_failure.HOOK_REFUSED)
	})

	it('reports a branch that reached origin as a pull request that was not opened', () => {
		expect(propagate_git_failure.describe_failure(pushed_but_no_pull_request())).toBe(
			propagate_git_failure.NOT_OPENED,
		)
	})
})

describe('propagate_git_failure.output_tail', () => {
	// The consumer's pre-push hook names the check that stopped it, and nothing else in the run keeps
	// those lines — this is the whole route from the one-line report to the real cause.
	it('carries the last lines of the output, which name the check that stopped', () => {
		const tail = propagate_git_failure.output_tail(HOOK_STREAMS)

		expect(tail).toContain(AUDIT_LINE)
		expect(tail).toContain(REFUSAL)
	})

	it('drops everything before the last few lines of a stream', () => {
		const long = [INSTALL_LINE, UNIT_LINE, E2E_LINE, AUDIT_LINE].join('\n')

		expect(propagate_git_failure.output_tail([long])).not.toContain(INSTALL_LINE)
	})

	// Tailing the two concatenated would be all stderr whenever stderr had enough lines, dropping
	// exactly the hook output this exists to carry — git writes its refusal to stderr while a hook's
	// own progress commonly goes to stdout.
	it('does not let one stream crowd the other out', () => {
		const noisy = ['a', 'b', 'c', 'd', 'e'].join('\n')
		const tail = propagate_git_failure.output_tail([HOOK_STDOUT, noisy])

		expect(tail).toContain(AUDIT_LINE)
		expect(tail).toContain('e')
	})

	// The report is one line per consumer, so a multi-line tail would break that block apart.
	it('folds the tail onto one line', () => {
		expect(propagate_git_failure.output_tail(HOOK_STREAMS)).not.toContain('\n')
	})

	// A push's progress meter overwrites one line with `\r`, so a whole meter counts as one line and
	// would fill a tail slot with kilobytes.
	it('treats carriage-return progress output as separate lines', () => {
		const meter = ['Enumerating objects', 'Counting objects', 'Compressing', 'Writing'].join('\r')

		expect(propagate_git_failure.output_tail([meter])).not.toContain('Enumerating')
	})

	it('strips the escape sequences a colored hook writes', () => {
		const colored = `${RED}failed${RESET}`

		expect(propagate_git_failure.output_tail([colored])).toContain(`${TAIL_LABEL}failed`)
	})

	it('adds nothing at all when the command printed nothing', () => {
		expect(propagate_git_failure.output_tail(['\n  \n', ''])).toBe('')
	})
})

describe('propagate_git_failure.leftover_note', () => {
	it('names both the uncommitted changes and the branch when both are there', () => {
		const note = propagate_git_failure.leftover_note(hook_refused())

		expect(note).toContain(propagate_git_failure.UNCOMMITTED)
		expect(note).toContain(BRANCH)
	})

	// The false report the issue was filed for: a commit had been made, so nothing about the upgrade
	// or the sync was sitting uncommitted, and saying it was sent the reader to the wrong place.
	it('does not claim uncommitted changes when the tree is clean', () => {
		expect(propagate_git_failure.leftover_note(push_never_landed())).not.toContain(
			propagate_git_failure.UNCOMMITTED,
		)
	})

	it('says nothing was left when the tree is clean and no branch was created', () => {
		const state: GitStepState = {
			branch: undefined,
			head_commit: undefined,
			is_tree_clean: true,
			is_on_remote: false,
			is_push_hook_blocked: false,
		}

		expect(propagate_git_failure.leftover_note(state)).toBe(propagate_git_failure.NOTHING_LEFT)
	})
})

// The consumer as `josh git` left it in the reported incident: committed, and the push refused.
function stub_committed_unpushed(): void {
	vi.mocked(propagate_git.current_branch).mockReturnValue(BRANCH)
	vi.mocked(propagate_git.commit_ahead).mockReturnValue(SHA)
	vi.mocked(propagate_git.has_remote_branch).mockReturnValue(false)
	vi.mocked(propagate_git.has_pre_push_hook).mockReturnValue(true)
	vi.mocked(propagate_git.can_push_without_hooks).mockReturnValue(true)
	vi.mocked(propagate_git.is_clean).mockReturnValue(false)
}

// Reset rather than clear: `clearAllMocks` keeps the previous test's return values, so a test could
// pass on a stub it never set and the file would be order-dependent.
beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(propagate_git.default_branch).mockReturnValue(MAIN)
	vi.mocked(propagate_git.is_clean).mockReturnValue(true)
})

describe('propagate_git_failure.read_state', () => {
	it('reads a checkout still on its default branch as having no feature branch', () => {
		vi.mocked(propagate_git.current_branch).mockReturnValue(MAIN)

		expect(propagate_git_failure.read_state(CONSUMER).branch).toBeUndefined()
	})

	// Two network round trips answering a question the classification never reaches.
	it('asks the remote nothing at all when no commit could have been pushed', () => {
		vi.mocked(propagate_git.current_branch).mockReturnValue(BRANCH)
		vi.mocked(propagate_git.commit_ahead).mockReturnValue(undefined)
		propagate_git_failure.read_state(CONSUMER)

		expect(propagate_git.has_remote_branch).not.toHaveBeenCalled()
		expect(propagate_git.can_push_without_hooks).not.toHaveBeenCalled()
	})

	it('reads a committed but unpushed branch as a push the hook refused', () => {
		stub_committed_unpushed()
		const read = propagate_git_failure.read_state(CONSUMER)

		expect(read.branch).toBe(BRANCH)
		expect(read.head_commit).toBe(SHA)
		expect(read.is_on_remote).toBe(false)
		expect(read.is_push_hook_blocked).toBe(true)
	})

	// A branch that reached origin cannot have been stopped by the hook, so neither probe is run.
	it('does not probe the push for a branch that is already on the remote', () => {
		vi.mocked(propagate_git.current_branch).mockReturnValue(BRANCH)
		vi.mocked(propagate_git.commit_ahead).mockReturnValue(SHA)
		vi.mocked(propagate_git.has_remote_branch).mockReturnValue(true)
		const read = propagate_git_failure.read_state(CONSUMER)

		expect(read.is_on_remote).toBe(true)
		expect(propagate_git.can_push_without_hooks).not.toHaveBeenCalled()
	})
})

// Any push failure that has cleared by the time the probe runs satisfies the dry run alone — so a
// consumer with no hook would be told a hook refused it, the misattribution pointed the other way.
describe('propagate_git_failure.read_state — a consumer with no pre-push hook', () => {
	it('does not name a hook in a consumer that has none', () => {
		stub_committed_unpushed()
		vi.mocked(propagate_git.has_pre_push_hook).mockReturnValue(false)

		expect(propagate_git_failure.read_state(CONSUMER).is_push_hook_blocked).toBe(false)
	})

	it('spends no round trip on the dry run when the consumer has no hook', () => {
		stub_committed_unpushed()
		vi.mocked(propagate_git.has_pre_push_hook).mockReturnValue(false)
		propagate_git_failure.read_state(CONSUMER)

		expect(propagate_git.can_push_without_hooks).not.toHaveBeenCalled()
	})
})

describe('propagate_git_failure.attribute', () => {
	it('replaces the bare exit code with the sub-step that produced it', () => {
		stub_committed_unpushed()
		const attributed = propagate_git_failure.attribute(
			CONSUMER,
			{ step: PR_STEP, is_ok: false, detail: EXIT_ONE },
			HOOK_STREAMS,
		)

		expect(attributed.detail).toContain(EXIT_ONE)
		expect(attributed.detail).toContain(propagate_git_failure.HOOK_REFUSED)
		expect(attributed.detail).toContain(AUDIT_LINE)
	})

	// The report used to say the upgrade and the sync were left uncommitted. They had been committed.
	it('records what the failure really left rather than the standing note', () => {
		stub_committed_unpushed()
		vi.mocked(propagate_git.is_clean).mockReturnValue(true)
		const attributed = propagate_git_failure.attribute(
			CONSUMER,
			{ step: PR_STEP, is_ok: false, detail: EXIT_ONE },
			[],
		)

		expect(attributed.leftover).toContain(BRANCH)
		expect(attributed.leftover).not.toContain(propagate_git_failure.UNCOMMITTED)
	})
})
