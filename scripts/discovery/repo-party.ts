import { repo_discovery } from './repo-discovery'
import { repo_origin, type RepoIdentity } from './repo-origin'
import { session_owner_pin } from './session-owner-pin'

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
function parse_owner_repo(owner_repo: string): RepoIdentity | undefined {
	return repo_origin.parse_origin_url(`https://${repo_origin.GITHUB_HOST}/${owner_repo}`)
}

function target_owner(owner_repo: string): string | undefined {
	return parse_owner_repo(owner_repo)?.owner
}

// The owner of the repository the session runs in: the one pinned at session start, else read
// locally from its `origin` — no network call and no authenticated CLI, so the guard that consults it
// stays synchronous. The pin is what keeps a mid-session remote rewrite from changing the answer
// (`session-owner-pin.ts`).
function current_owner(repository_path: string = process.cwd()): string | undefined {
	return (
		session_owner_pin.pinned(repository_path) ??
		repo_discovery.resolve_current_owner(repository_path)
	)
}

// The repository a `[HOST/]OWNER/REPO` selector names — `GH_REPO`, or `gh`'s `-R` / `--repo` value —
// read from its last two segments so an optional host prefix is skipped.
function selector_repository(selector: string): RepoIdentity | undefined {
	return parse_owner_repo(selector.split('/').slice(-GH_REPO_PATH_SEGMENTS).join('/'))
}

function selector_owner(selector: string): string | undefined {
	return selector_repository(selector)?.owner
}

// Every remote the work tree declares. A remote that cannot be read stays in the set as `undefined`
// rather than being dropped: an SSH host alias (`git@github-work:o/r.git`) is one `gh` translates to
// github.com and may pick, so dropping it would hide the repository `gh` writes to.
function remote_repositories(repository_path: string): Array<RepoIdentity | undefined> {
	return repo_discovery
		.read_remote_urls(repository_path)
		.map((url) => repo_origin.parse_origin_url(url))
}

// Every repository `gh` could expand the `{owner}/{repo}` placeholders to. `GH_REPO`
// (`[HOST/]OWNER/REPO`) overrides the remotes outright; otherwise `gh` picks its base repository among
// the GitHub remotes — `upstream` ahead of `origin`, or a `gh repo set-default` choice — so in a fork
// checkout it can expand to the upstream repository. Answering the whole candidate set rather than
// re-implementing that pick keeps the caller safe whichever remote `gh` chooses. An `undefined` entry
// is a candidate that could not be read, which the caller must not assume is first-party.
function placeholder_repositories(
	repository_path: string,
	environment: NodeJS.ProcessEnv,
): Array<RepoIdentity | undefined> {
	const gh_repo = environment[GH_REPO_ENV_KEY]

	return gh_repo === undefined || gh_repo === ''
		? remote_repositories(repository_path)
		: [selector_repository(gh_repo)]
}

function placeholder_owners(
	repository_path: string = process.cwd(),
	environment: NodeJS.ProcessEnv = process.env,
): Array<string | undefined> {
	return placeholder_repositories(repository_path, environment).map((identity) => identity?.owner)
}

// Two spellings of one repository, compared case-insensitively as GitHub resolves them.
function is_same_repository(left: RepoIdentity | undefined, right: RepoIdentity): boolean {
	if (left === undefined || classify(left.owner, right.owner) !== FIRST_PARTY) return false

	return left.repo.toLowerCase() === right.repo.toLowerCase()
}

// The one repository every candidate names, or nothing when there is none, one is unreadable, or two
// differ — a fork checkout whose `upstream` `gh` may pick ahead of `origin`.
function sole_repository(
	candidates: ReadonlyArray<RepoIdentity | undefined>,
): RepoIdentity | undefined {
	const [first, ...rest] = candidates
	if (first === undefined) return undefined

	return rest.every((candidate) => is_same_repository(candidate, first)) ? first : undefined
}

// The checkout's own repository: the one `{owner}/{repo}` expands to — where `josh issue:comment`
// posts. Nothing unless that is one repository whichever candidate `gh` picks, so a spelled-out
// repository is never read as the one `issue:comment` reaches when it might not be
// (joshuafolkken/kit#4737).
function current_repository(
	repository_path: string = process.cwd(),
	environment: NodeJS.ProcessEnv = process.env,
): RepoIdentity | undefined {
	return sole_repository(placeholder_repositories(repository_path, environment))
}

// Whether `target` is the checkout's own repository `current_repository` answered.
function is_own_repository(target: RepoIdentity, own: RepoIdentity | undefined): boolean {
	return is_same_repository(own, target)
}

const repo_party = {
	FIRST_PARTY,
	THIRD_PARTY,
	UNKNOWN,
	classify,
	current_owner,
	current_repository,
	is_own_repository,
	placeholder_owners,
	selector_owner,
	sole_repository,
	target_owner,
}

export type { Party }
export { repo_party }
