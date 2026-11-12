import { existsSync } from 'node:fs'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_resolve } from './lane-resolve'

// `josh lane:resolve <issue> --record [<path>...]` — step 4 of `backlogrun-recovery.md`'s
// merge-conflict path as a command (joshuafolkken/kit#5922). The resolution comment is what step-back
// condition 3 counts, so it is posted only once the concluded merge is on origin: a comment for a
// resolution that never left this checkout would park the child's next conflict for nothing.

type RecordOutcome = { kind: 'recorded'; url: string } | { kind: 'refused'; message: string }

const ABSENT = 'absent'

function body_of(paths: ReadonlyArray<string>): string {
	const lines = paths.map((path) => `- \`${path}\``)

	return [lane_resolve.RESOLUTION_HEADING, '', ...lines].join('\n').trimEnd()
}

// An unconcluded merge still sits on the pushed commit, so HEAD alone would read it as pushed.
async function is_merging(): Promise<boolean> {
	return existsSync(await git_spawn.read(['rev-parse', '--git-path', 'MERGE_HEAD']))
}

async function origin_commit(branch: string): Promise<string> {
	const line = await git_worktree.ls_remote_branch(branch)
	const [commit] = line.split('\t', 1)

	return commit === undefined || commit === '' ? ABSENT : commit
}

async function unpushed(issue: string): Promise<string | undefined> {
	if (await is_merging()) return 'the merge is not concluded — conclude and push it first'
	const branch = `${issue}${lane_resolve.LANE_BRANCH_SUFFIX}`
	const [head, origin] = await Promise.all([git_command.head_commit(), origin_commit(branch)])

	if (head === origin) return undefined

	return `${branch} is not pushed: HEAD ${head}, origin ${origin} — push it with \`pnpm josh git -y\` first`
}

async function record(issue: string, paths: ReadonlyArray<string>): Promise<RecordOutcome> {
	const wrong = await lane_resolve.wrong_branch(issue)

	if (wrong?.kind === 'refused') return wrong
	const message = await unpushed(issue)

	if (message !== undefined) return { kind: 'refused', message }

	return { kind: 'recorded', url: await git_gh_command.issue_comment(issue, body_of(paths)) }
}

const lane_resolve_record = { record }

export { lane_resolve_record }
export type { RecordOutcome }
