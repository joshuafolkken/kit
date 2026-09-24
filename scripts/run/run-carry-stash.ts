import { git_stash } from '#scripts/git/git-stash'
import { stash_orphans } from '#scripts/git/stash-orphans'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { bounded_pool } from '#scripts/lib/bounded-pool'

// The stash check a `backlogrun` makes at its end (joshuafolkken/kit#2505): the entries whose issue has
// closed, and those with no readable owner, printed for a person to revive or discard. It rides
// `run:carry --end` for the ledger flush's reason — `--end` is the invocation's one end across every
// session cut, where `--begin` repeats on each resume. Standard output is `run:carry`'s one-token
// contract, so the report goes to standard error, and a failed read is a note rather than a failed end.

const READ_CONCURRENCY = 8
const CLOSED_STATE = 'CLOSED'
const FAILURE_NOTE =
	'The closed-issue stash check failed; review the stack by hand with `git stash list`.'

type Verdict = 'closed' | 'open' | 'unreadable'

interface ClosedRead {
	closed: Set<string>
	unreadable: Array<string>
}

// Only a read that answers `CLOSED` counts as closed: a missing or unreadable issue is not evidence the
// work is abandoned, and reporting it as closed would invite a person to drop live work.
async function verdict_of(issue: string): Promise<Verdict> {
	const read = await issue_state_cli.read_issue(issue)

	if (read.kind !== 'state') return 'unreadable'

	return read.state.state === CLOSED_STATE ? 'closed' : 'open'
}

async function read_closed(issues: ReadonlyArray<string>): Promise<ClosedRead> {
	const verdicts = await bounded_pool.bounded_map(
		issues,
		READ_CONCURRENCY,
		async (issue) => await verdict_of(issue),
	)

	return {
		closed: new Set(issues.filter((_issue, index) => verdicts[index] === 'closed')),
		unreadable: issues.filter((_issue, index) => verdicts[index] === 'unreadable'),
	}
}

// `read_issue` answers a failed `gh` call as `unreadable` rather than throwing, so a missing `gh` or a
// rate limit would otherwise empty the closed set and print a report that looks complete.
function unreadable_note(unreadable: ReadonlyArray<string>): string {
	const issues = unreadable.map((issue) => `#${issue}`).join(', ')

	return `Could not read ${issues}, so a stash of theirs may be missing above; ${FAILURE_NOTE}`
}

async function report_orphans(): Promise<void> {
	try {
		const entries = await git_stash.list()
		const read = await read_closed(stash_orphans.issues_of(entries))
		const report = stash_orphans.format_report(stash_orphans.orphans(entries, read.closed))

		if (report !== undefined) console.error(report)

		if (read.unreadable.length > 0) console.error(unreadable_note(read.unreadable))
	} catch {
		console.error(FAILURE_NOTE)
	}
}

const run_carry_stash = { FAILURE_NOTE, report_orphans }

export { run_carry_stash }
