import { git_spawn } from './git-spawn'

// The local branches `josh ms` removes after it syncs (joshuafolkken/kit#2504). The repository
// deletes a pull request's remote branch at the merge, and nothing removed the local copy: measured on
// 2026-09-24, 212 of the primary checkout's 244 local branches tracked an upstream that was `[gone]`.
//
// **A branch is removed only when all three hold** — its upstream is gone, it is merged into the
// default branch, and no work tree has it checked out. Gone alone is not enough: a branch whose remote
// was deleted by hand before its work merged still holds the only copy of it. A branch with no
// upstream at all is never gone, so a local-only branch stays.
//
// **One `for-each-ref` read carries the work-tree answer too** — `%(worktreepath)` is git's own
// record of which tree holds the branch, so no `git worktree list` parse is repeated here.

const FIELD_SEPARATOR = '\t'
const GONE_TRACK = '[gone]'
// `lstrip=2` rather than `short`: `short` prints `heads/<name>` for a branch whose name a tag shares,
// and `git branch -d` would then be handed a name it cannot find.
const BRANCH_NAME = '%(refname:lstrip=2)'
const RECORD_FORMAT = [BRANCH_NAME, '%(upstream:track)', '%(upstream)', '%(worktreepath)'].join(
	FIELD_SEPARATOR,
)
const LOCAL_HEADS = 'refs/heads'
const REMOTE_HEADS = 'refs/remotes/'
const FOR_EACH_REF = 'for-each-ref'
const NAME_FIELD = 0
const TRACK_FIELD = 1
const UPSTREAM_FIELD = 2
const WORKTREE_FIELD = 3

interface BranchRecord {
	name: string
	is_gone: boolean
	is_checked_out: boolean
}

interface PruneResult {
	deleted: Array<string>
	failed: Array<string>
}

function non_empty_lines(output: string): Array<string> {
	return output.split('\n').filter((line) => line.trim() !== '')
}

function parse_record(line: string): BranchRecord {
	const fields = line.split(FIELD_SEPARATOR)

	return {
		name: fields[NAME_FIELD] ?? '',
		is_gone:
			fields[TRACK_FIELD] === GONE_TRACK && (fields[UPSTREAM_FIELD] ?? '').startsWith(REMOTE_HEADS),
		is_checked_out: (fields[WORKTREE_FIELD] ?? '') !== '',
	}
}

function parse_records(output: string): Array<BranchRecord> {
	return non_empty_lines(output).map((line) => parse_record(line))
}

function select_prunable(
	records: ReadonlyArray<BranchRecord>,
	merged: ReadonlySet<string>,
	default_branch: string,
): Array<string> {
	return records
		.filter((record) => record.is_gone && !record.is_checked_out && merged.has(record.name))
		.map((record) => record.name)
		.filter((name) => name !== default_branch)
}

async function read_candidates(default_branch: string): Promise<Array<string>> {
	const records = await git_spawn.read([FOR_EACH_REF, `--format=${RECORD_FORMAT}`, LOCAL_HEADS])
	const merged = await git_spawn.read([
		FOR_EACH_REF,
		`--merged=refs/heads/${default_branch}`,
		`--format=${BRANCH_NAME}`,
		LOCAL_HEADS,
	])

	return select_prunable(parse_records(records), new Set(non_empty_lines(merged)), default_branch)
}

// `-d` rather than `-D` is the second net under the merged check: git refuses a branch it does not
// itself see as merged, so a disagreement between the two reads leaves the branch rather than a lost
// commit. One refusal does not stop the rest, and is reported rather than thrown.
async function delete_each(names: ReadonlyArray<string>): Promise<PruneResult> {
	const result: PruneResult = { deleted: [], failed: [] }

	for (const name of names) {
		try {
			await git_spawn.read(['branch', '-d', name])
			result.deleted.push(name)
		} catch {
			result.failed.push(name)
		}
	}

	return result
}

// `fetch --prune` first, because `[gone]` is read from the remote-tracking refs and those outlive the
// remote branch until something prunes them.
async function prune(default_branch: string): Promise<PruneResult> {
	await git_spawn.read(['fetch', '--prune'])

	return await delete_each(await read_candidates(default_branch))
}

const gone_branch = { parse_records, prune, select_prunable }

export type { BranchRecord, PruneResult }
export { gone_branch }
