import { session_cite } from '#scripts/issue/session-cite'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'

// The release a landed park runs (joshuafolkken/kit#5737) — `run:release <N>`'s own implementation,
// so the hold and `in-progress` come off exactly as the hand-typed release took them.
//
// **A tree another run holds is that run's to release**: a split lane parks a leftover child of its
// own issue, and the parent parks a child from a checkout a sequential child holds. Releasing as the
// parked issue would answer `held` there and leave a re-run that can never succeed, so the park
// releases nothing and the holder's own ending releases its tree.
//
// A git directory that cannot be read names no other run: the release runs and reports its own
// failure, so the park still exits non-zero with the re-run line rather than an escaped rejection.

const SUCCESS_EXIT_CODE = 0
const RELEASE_FLAG = '--release'

async function read_worktree_directory(): Promise<string | undefined> {
	try {
		return await run_hold.worktree_directory()
	} catch {
		return undefined
	}
}

async function is_held_by_other_run(issue_number: string): Promise<boolean> {
	const directory = await read_worktree_directory()

	if (directory === undefined) return false

	const read = run_hold.read_hold(run_hold.hold_path(directory))

	return 'hold' in read && !run_hold.is_own_hold(read.hold, issue_number)
}

async function release_own(issue_number: string): Promise<number> {
	const code = await run_hold_cli.run([RELEASE_FLAG, issue_number])

	if (code !== SUCCESS_EXIT_CODE) {
		console.error(
			`park ${session_cite.issue(issue_number)} — parked, but the release failed; re-run: pnpm josh run:release ${issue_number}`,
		)
	}

	return code
}

async function release(issue_number: string): Promise<number> {
	if (!(await is_held_by_other_run(issue_number))) return await release_own(issue_number)

	console.info(
		`park ${session_cite.issue(issue_number)} — release skipped: this tree's hold is another run's`,
	)

	return SUCCESS_EXIT_CODE
}

const run_park_release = { release }

export { run_park_release }
