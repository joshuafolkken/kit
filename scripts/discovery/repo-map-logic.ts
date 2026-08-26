import { repo_origin, type RepoIdentity } from './repo-origin'

// Assembling the `owner/repo` → local path map from what the scan found.
//
// The owner restriction lives here, on the single path every entry travels, rather than in the
// scanner: an override that could re-enter the map behind the filter would be the hole the
// restriction exists to close. Discovered entries and overrides are both funnelled through
// `add_entry`, so there is exactly one place that decides what is allowed in
// (joshuafolkken/kit#869).

// One candidate the scan produced: a directory holding a git work tree, and the `origin` remote it
// declares. `origin_url` is undefined for a work tree with no `origin` at all.
interface DiscoveredRepo {
	path: string
	origin_url: string | undefined
}

// `owner/repo` → absolute local path.
type RepoMap = ReadonlyMap<string, string>

const OVERRIDE_ENTRY_SEPARATOR = ','
const OVERRIDE_PAIR_SEPARATOR = '='
const OVERRIDE_PAIR_PARTS = 2
const KEY_INDEX = 0
const PATH_INDEX = 1

// Whether an identity belongs to the same owner as the repository the command is running in. This is
// the first-party test the AI documents define — owner equality, nothing else — and it is not
// configurable: a sibling directory belonging to another account or organization would otherwise be
// a repository this tooling could file issues against or push to.
function is_same_owner(identity: RepoIdentity, current_owner: string): boolean {
	return identity.owner.toLowerCase() === current_owner.toLowerCase()
}

// The single gate. Anything reaching the map passes through here, so the owner restriction cannot be
// bypassed by supplying an entry from a different source.
function add_entry(
	target: Map<string, string>,
	origin_url: string | undefined,
	repository_path: string,
	current_owner: string,
): void {
	if (origin_url === undefined) return
	const identity = repo_origin.parse_origin_url(origin_url)
	if (identity === undefined) return
	if (!is_same_owner(identity, current_owner)) return

	target.set(repo_origin.format_identity(identity), repository_path)
}

// One `owner/repo=/absolute/path` pair from the override variable. The key is re-parsed as a remote
// rather than trusted as written, so an override is held to the same normalization and the same
// owner restriction as a discovered entry.
function parse_override_entry(entry: string): DiscoveredRepo | undefined {
	const parts = entry.split(OVERRIDE_PAIR_SEPARATOR).map((part) => part.trim())
	if (parts.length !== OVERRIDE_PAIR_PARTS) return undefined
	const key = parts[KEY_INDEX] ?? ''
	const repository_path = parts[PATH_INDEX] ?? ''
	if (repository_path === '') return undefined

	return { path: repository_path, origin_url: `https://${repo_origin.GITHUB_HOST}/${key}` }
}

// The override variable's entries, in order. Malformed entries are dropped rather than failing the
// command: `josh doctor` is what a user runs when something is already wrong, and the map it prints
// is what shows them the override did not take effect.
function parse_overrides(raw: string | undefined): Array<DiscoveredRepo> {
	if (raw === undefined) return []

	return raw
		.split(OVERRIDE_ENTRY_SEPARATOR)
		.map((entry) => parse_override_entry(entry))
		.filter((entry): entry is DiscoveredRepo => entry !== undefined)
}

// The map, from what the scan found plus whatever the override variable adds. Overrides are applied
// last so an explicit path wins over a discovered one — the escape hatch for a repository that is
// not a sibling, or one checked out more than once — but they win only *within* the owner
// restriction, never around it.
function build_repository_map(
	discovered: ReadonlyArray<DiscoveredRepo>,
	current_owner: string,
	override_value?: string,
): RepoMap {
	const result = new Map<string, string>()

	for (const entry of discovered) add_entry(result, entry.origin_url, entry.path, current_owner)

	for (const entry of parse_overrides(override_value)) {
		add_entry(result, entry.origin_url, entry.path, current_owner)
	}

	return result
}

const repo_map_logic = {
	is_same_owner,
	parse_overrides,
	build_repository_map,
}

export type { DiscoveredRepo, RepoMap }
export { repo_map_logic }
