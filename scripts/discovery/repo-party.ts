import { repo_discovery } from './repo-discovery'
import { repo_origin } from './repo-origin'

// **First-party vs third-party, computed rather than judged** (joshuafolkken/kit#2122). `CLAUDE.md`
// and `upstream-interrupt.md` both declared the test mechanical — owner equality between the target
// repository and the session's — yet nothing computed it: three prose spots restated the manual
// `gh api … --jq .owner.login`, and whether an owner had actually been read was left to trust. This is
// the computation those documents describe, so the rule that refuses a third-party write and the
// `josh repo:party` oracle read one definition rather than two.
//
// **The owner comparison is case-insensitive**, because GitHub resolves owner names that way — the
// same reason `repo-origin.ts` lowercases the discovery key. Two spellings of one owner are one owner.

type Party = 'first-party' | 'third-party' | 'unknown'

const FIRST_PARTY: Party = 'first-party'
const THIRD_PARTY: Party = 'third-party'
const UNKNOWN: Party = 'unknown'

// `unknown` is not `third-party`. An owner that cannot be read — no `origin`, an unreadable config —
// is a "cannot decide", and reading it as third-party would refuse first-party writes whenever the
// session's own remote was momentarily unreadable. The caller decides what a `unknown` licenses;
// the deny rule treats it as "not proven third-party" and stays silent.
function classify(session_owner: string | undefined, target: string | undefined): Party {
	if (session_owner === undefined || target === undefined) return UNKNOWN

	return session_owner.toLowerCase() === target.toLowerCase() ? FIRST_PARTY : THIRD_PARTY
}

// The owner half of a `owner/repo` argument, parsed through the remote-URL reader so a `.git` suffix
// and a malformed form (one segment, three segments) are handled by the one place that already knows
// them rather than by a second split here.
function target_owner(owner_repo: string): string | undefined {
	return repo_origin.parse_origin_url(`https://${repo_origin.GITHUB_HOST}/${owner_repo}`)?.owner
}

// The owner of the repository the session runs in, read locally from its `origin` — no network call
// and no authenticated CLI, so the guard that consults it stays synchronous.
function current_owner(repository_path: string = process.cwd()): string | undefined {
	return repo_discovery.resolve_current_owner(repository_path)
}

const repo_party = { FIRST_PARTY, THIRD_PARTY, UNKNOWN, classify, current_owner, target_owner }

export type { Party }
export { repo_party }
