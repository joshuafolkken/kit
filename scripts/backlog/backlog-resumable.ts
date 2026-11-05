import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_orphans } from '#scripts/git/stash/stash-orphans'

function enrich_children(
	children: ReadonlyArray<EpicChild>,
	repo: string,
	stashed: ReadonlySet<string>,
): Array<EpicChild> {
	return children.map((child) =>
		child.repo === repo ? { ...child, is_resumable: stashed.has(String(child.number)) } : child,
	)
}

// Stashes are shared by this repository's lanes, never by another repository with the same issue number.
async function read(result: EpicNextResult, repo: string): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result
	const stashed = new Set(stash_orphans.issues_of(await git_stash.list()))
	const candidates = result.candidates.map((bundle) => ({
		...bundle,
		children: enrich_children(bundle.children, repo, stashed),
	}))

	return { ...result, candidates, waiting: enrich_children(result.waiting, repo, stashed) }
}

const backlog_resumable = { read }

export { backlog_resumable }
