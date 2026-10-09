import { repo_discovery } from './repo-discovery'
import { repo_origin } from './repo-origin'

// **First-party vs third-party, computed rather than judged**. `CLAUDE.md`
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
const GH_REPO_ENV_KEY = 'GH_REPO'
const GH_REPO_PATH_SEGMENTS = 2

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

// The owner `GH_REPO` names, read from its last two segments so an optional host prefix is skipped.
function gh_repo_owners(gh_repo: string): Array<string | undefined> {
	return [target_owner(gh_repo.split('/').slice(-GH_REPO_PATH_SEGMENTS).join('/'))]
}

// The owner of every remote the work tree declares. A remote whose owner cannot be read stays in the
// set as `undefined` rather than being dropped: an SSH host alias (`git@github-work:o/r.git`) is one
// `gh` translates to github.com and may pick, so dropping it would hide the owner `gh` writes to.
function remote_owners(repository_path: string): Array<string | undefined> {
	return repo_discovery
		.read_remote_urls(repository_path)
		.map((url) => repo_origin.parse_origin_url(url)?.owner)
}

// Every owner `gh` could expand the `{owner}` placeholder to. `GH_REPO`
// (`[HOST/]OWNER/REPO`) overrides the remotes outright; otherwise `gh` picks its base repository among
// the GitHub remotes — `upstream` ahead of `origin`, or a `gh repo set-default` choice — so in a fork
// checkout it can expand to the upstream owner. Answering the whole candidate set rather than
// re-implementing that pick keeps the caller safe whichever remote `gh` chooses. An `undefined` entry
// is a candidate whose owner could not be read, which the caller must not assume is first-party.
function placeholder_owners(
	repository_path: string = process.cwd(),
	environment: NodeJS.ProcessEnv = process.env,
): Array<string | undefined> {
	const gh_repo = environment[GH_REPO_ENV_KEY]

	return gh_repo === undefined || gh_repo === ''
		? remote_owners(repository_path)
		: gh_repo_owners(gh_repo)
}

const repo_party = {
	FIRST_PARTY,
	THIRD_PARTY,
	UNKNOWN,
	classify,
	current_owner,
	placeholder_owners,
	target_owner,
}

export type { Party }
export { repo_party }
