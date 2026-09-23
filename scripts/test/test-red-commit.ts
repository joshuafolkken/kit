import { git_gh_issue_read } from '#scripts/git/git-gh-issue-read'
import { test_red, type RedRun } from './test-red'
import { test_red_logic } from './test-red-logic'

// The commit-stage half of joshuafolkken/kit#2448: `josh git -y` on an Issue that declares itself a
// bug fix (`test_red_logic.BUG_DECLARATION_LINE`) refuses a commit whose tests are all green on the
// pre-fix tree.
//
// **It lives in the commit flow, not in a `PreToolUse` row beside `test-declared-commit.ts`.** A hook
// guard answers synchronously, and this answer needs the Issue body from the network and a Vitest run
// in a worktree; the commit flow is asynchronous and already holds the Issue number.

interface RedCommitPorts {
	read_body: (issue_number: string) => Promise<string | undefined>
	run: () => Promise<RedRun>
}

const DEFAULT_PORTS: RedCommitPorts = {
	read_body: git_gh_issue_read.issue_get_body,
	run: test_red.run,
}

function reason_for(issue_number: string, files: ReadonlyArray<string>): string {
	return (
		`⛔ test:red — #${issue_number} declares \`${test_red_logic.BUG_DECLARATION_LINE}\`, but every ` +
		'changed test passes on the pre-fix tree (the merge-base), so none of them reproduces the ' +
		`reported symptom:\n  ${files.join('\n  ')}\n` +
		'Write a regression test at the grain the user saw the symptom (the whole output, not a ' +
		'helper), confirm `pnpm josh test:red` prints `red`, and reissue the commit.'
	)
}

// Throws the refusal when the Issue is a declared bug fix and the verdict is `green`; otherwise
// returns. An unreadable body is not a declaration, so it refuses nothing.
async function assert_reproduces(
	issue_number: string,
	ports: RedCommitPorts = DEFAULT_PORTS,
): Promise<void> {
	const body = await ports.read_body(issue_number)

	if (body === undefined || !test_red_logic.is_bug_fix(body)) return

	const { verdict, files } = await ports.run()

	if (test_red_logic.is_refused(body, verdict)) throw new Error(reason_for(issue_number, files))
}

const test_red_commit = { assert_reproduces, reason_for }

export type { RedCommitPorts }
export { test_red_commit }
