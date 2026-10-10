import { destructive_command } from './destructive-command'
import { direct_pr_create } from './direct-pr-create'
import { index_guard } from './index-guard'
import { protected_files } from './protected-files'

// The three rows that close the deny-list bypasses, gathered so
// `delivered-rules.ts` spreads one entry. Each reads argv or a file path rather than a glob: an index
// mutation in any git spelling, a recursive forced `rm` or a destructive `gh` call, and a Read of
// `.env` or an edit of a consumer's `.claude/settings.json`. Their triggers are disjoint from every
// other row's — `git restore` is split with `worktree-mutation` by `--staged` alone. The fourth row,
// `direct-pr-create`, closes the same kind of gap for `gh pr create`, which
// the deny list never listed: it claims `gh pr create` and a `gh api` write to the pulls collection.
const ROWS = [
	index_guard.ROW,
	destructive_command.ROW,
	protected_files.ROW,
	direct_pr_create.ROW,
] as const

const permission_guards = { ROWS }

export { permission_guards }
