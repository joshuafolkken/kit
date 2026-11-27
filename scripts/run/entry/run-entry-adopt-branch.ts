// joshuafolkken/kit#9148: the lane entry takes in the wip branch the Issue body's adopt-branch row names,
// right after the tree is synchronized with main. `claim_run` calls it for the root and the lane child
// alike, so every lane — a `kickoff new` Issue a later `backlogrun` picks up included — passes here. A
// branch already taken in is left alone; anything it cannot take in stops the entry with the reason,
// never a silent rebuild. The `wip/` branch itself is never deleted here.

import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_ancestor } from '#scripts/git/git-ancestor'
import { git_spawn } from '#scripts/git/git-spawn'
import { issue_body_adopt_branch, type AdoptBranch } from '#scripts/issue/issue-body-adopt-branch'
import type { EntryRequest } from './run-entry-children'
import { run_entry_sync, type EntryStop } from './run-entry-sync'

const REASON = 'the Issue names a wip branch the lane could not take in — see the run:entry output'
const RECOMMENDED =
	'Make the named commit reachable on its branch here (or fix the row), then resume'
const HEAD = 'HEAD'
const NO_BODY = ''

function stop_of(note: string): EntryStop {
	return { report: `(adopt branch: ${note})`, notice: { reason: REASON, recommended: RECOMMENDED } }
}

const { is_ancestor, succeeds } = git_ancestor

// The branch here, fetched from `origin` when absent; another machine's local `wip/` stays unreachable.
async function has_branch(branch: string): Promise<boolean> {
	if (await succeeds(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) return true

	try {
		await git_spawn.read_remote(['fetch', '--no-tags', 'origin', `${branch}:${branch}`])

		return true
	} catch {
		return false
	}
}

// The row's commit merged — not the branch's tip, which may have moved on; a conflict is aborted.
async function merged(row: AdoptBranch): Promise<EntryStop | undefined> {
	try {
		await git_spawn.read(['merge', '--no-edit', row.sha])

		return undefined
	} catch {
		await succeeds(['merge', '--abort'])

		return stop_of(`merging ${row.sha} from ${row.branch} conflicted; aborted — merge it by hand`)
	}
}

async function adopted(row: AdoptBranch): Promise<EntryStop | undefined> {
	if (await is_ancestor(row.sha, HEAD)) return undefined

	if (!(await has_branch(row.branch))) {
		return stop_of(`no branch ${row.branch} here or on origin to take ${row.sha} from`)
	}

	if (!(await is_ancestor(row.sha, row.branch))) {
		return stop_of(`${row.sha} is not on ${row.branch}`)
	}

	return await merged(row)
}

// The entry's stop when the row cannot be taken in; `undefined` without a row or once it is in.
async function adopt(issue_number: string): Promise<EntryStop | undefined> {
	const body = await git_gh_issue_read.issue_get_body(issue_number)
	const present = issue_body_adopt_branch.read(body ?? NO_BODY)

	if (present.kind === 'malformed') return stop_of(present.note)

	return present.kind === 'row' ? await adopted(present.row) : undefined
}

// The entry's synchronization: the tree synchronized with main, then the row's branch taken in.
async function synced(request: EntryRequest): Promise<EntryStop | undefined> {
	return (await run_entry_sync.sync(request)) ?? (await adopt(request.issue_number))
}

const run_entry_adopt_branch = { adopt, synced }

export { run_entry_adopt_branch }
