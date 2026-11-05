import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_orphans } from '#scripts/git/stash/stash-orphans'
import { issue_closing_pr } from '#scripts/issue/issue-closing-pr'
import { run_pause_comment } from '#scripts/run/pause/run-pause-comment'

async function is_resumable(issue: string, stashed: ReadonlySet<string>): Promise<boolean> {
	if (stashed.has(issue) || (await run_pause_comment.is_paused(issue))) return true

	return await issue_closing_pr.has_open_pr(issue)
}

async function enrich_children(
	children: ReadonlyArray<EpicChild>,
	repo: string,
	stashed: ReadonlySet<string>,
): Promise<Array<EpicChild>> {
	return await Promise.all(
		children.map(async (child) =>
			child.repo === repo
				? { ...child, is_resumable: await is_resumable(String(child.number), stashed) }
				: child,
		),
	)
}

// Stashes are shared by this repository's lanes, never by another repository with the same issue number.
async function read(result: EpicNextResult, repo: string): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result
	const stashed = new Set(stash_orphans.issues_of(await git_stash.list()))
	const candidates = await Promise.all(
		result.candidates.map(async (bundle) => ({
			...bundle,
			children: await enrich_children(bundle.children, repo, stashed),
		})),
	)

	return { ...result, candidates, waiting: await enrich_children(result.waiting, repo, stashed) }
}

const backlog_resumable = { read }

export { backlog_resumable }
