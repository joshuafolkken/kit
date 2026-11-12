import { delivered_rules_guard } from './delivered-rules-guard'
import { destructive_command } from './destructive-command'
import { direct_pr_create } from './direct-pr-create'
import { egress_guard } from './egress-guard'
import { index_guard } from './index-guard'
import { pr_merge } from './pr-merge'
import { protected_files } from './protected-files'
import { repo_admin } from './repo-admin'

// The three rows that close the deny-list bypasses, gathered so
// `delivered-rules.ts` spreads one entry. Each reads argv or a file path rather than a glob: an index
// mutation in any git spelling, a recursive forced `rm` or a destructive `gh` call, and a Read of
// `.env` or an edit of a consumer's `.claude/settings.json`. Their triggers are disjoint from every
// other row's — `git restore` is split with `worktree-mutation` by `--staged` alone. The fourth row,
// `direct-pr-create`, closes the same kind of gap for `gh pr create`, which
// the deny list never listed: it claims `gh pr create` and a `gh api` write to the pulls collection.
// The fifth, `pr-merge`, claims a merge in every spelling the `gh pr merge*` glob misses. The sixth,
// `repo-admin`, claims a non-`DELETE` write to the repository's administration, which
// `destructive-command` leaves open. The seventh, `egress`, claims a network send or a credential
// print in any command the call runs, which the `Bash(curl *)` family of globs cannot reach.
const ROWS = [
	index_guard.ROW,
	destructive_command.ROW,
	delivered_rules_guard.call_only(protected_files.ROW),
	direct_pr_create.ROW,
	pr_merge.ROW,
	repo_admin.ROW,
	egress_guard.ROW,
] as const

const permission_guards = { ROWS }

export { permission_guards }
