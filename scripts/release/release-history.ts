import { git_command } from '#scripts/git/git-command'
import { package_with_version_schema } from '#scripts/schemas'
import { version_targets } from '#scripts/version/version-targets'
import { release_plan, type ReleasePlan, type VersionedCommit } from './release-plan'

// Reading main's history for the two numbers a release is made of: where the version last changed,
// and how many merges have landed since (joshuafolkken/kit#1169).

const { PACKAGE_JSON } = version_targets

// How far back the search for "the commit that last changed the version" goes, counted in commits
// that touched `package.json`. Once children stop bumping (joshuafolkken/kit#1486) that file still
// changes for every dependency update, so the base can sit several entries down — but a repository
// that has taken thirty `package.json` commits without a single release has a different problem, and
// guessing past that point would be worse than saying so.
const BASE_SEARCH_LIMIT = 30

// **Which ref the history is read from.** `josh release` runs on a pulled default branch, so `HEAD`
// is main there and the default is right. A caller on a feature branch names the ref it means —
// `origin/main` — because `--first-parent` from a branch tip walks that branch rather than main, and
// the count would silently omit every merge main took after the branch was cut
// (joshuafolkken/kit#1486).
const DEFAULT_TIP = 'HEAD'

// The reads this module makes, named so a test can answer them without a git repository. Production
// callers take the default and never pass one.
interface HistoryReader {
	log_first_parent: (limit: number, file_path: string, tip: string) => Promise<Array<string>>
	show_file: (spec: string) => Promise<string>
	count_merges: (range: string) => Promise<number>
}

const git_reader: HistoryReader = {
	log_first_parent: git_command.log_first_parent,
	show_file: git_command.show_file,
	count_merges: git_command.count_merges,
}

// **Undefined rather than a throw for a `package.json` that cannot be read as one.** A revision where
// the file is absent or malformed is not a version change, and the comparison above wants that
// expressed as "no version here" rather than as an exception that ends the search.
function parse_version(content: string | undefined): string | undefined {
	if (content === undefined) return undefined

	try {
		return package_with_version_schema.parse(JSON.parse(content)).version
	} catch {
		return undefined
	}
}

async function read_version_at(
	reader: HistoryReader,
	reference: string,
): Promise<string | undefined> {
	try {
		// `./` is not decoration. `git show <sha>:package.json` resolves against the **repository
		// root**, while the `git log -- package.json` that produced these revisions resolves against
		// **cwd** — so run from a workspace sub-package the two halves would be comparing different
		// files, and every version comparison would be against the wrong one. `./` makes `show`
		// cwd-relative too, which is also what `read_workspace_version(process.cwd())` reads.
		return parse_version(await reader.show_file(`${reference}:./${PACKAGE_JSON}`))
	} catch {
		return undefined
	}
}

async function read_versioned_commits(
	reader: HistoryReader,
	tip: string,
): Promise<Array<VersionedCommit>> {
	const shas = await reader.log_first_parent(BASE_SEARCH_LIMIT, PACKAGE_JSON, tip)

	return await Promise.all(
		shas.map(async (sha) => ({ sha, version: await read_version_at(reader, sha) })),
	)
}

async function read_base(
	reader: HistoryReader = git_reader,
	tip: string = DEFAULT_TIP,
): Promise<string | undefined> {
	const commits = await read_versioned_commits(reader, tip)
	const oldest = commits.at(-1)
	const oldest_parent_version =
		oldest === undefined ? undefined : await read_version_at(reader, `${oldest.sha}^`)

	return release_plan.find_version_base(commits, oldest_parent_version)
}

// **Undefined means the base could not be found**, never "there is nothing to release" — the two have
// to stay distinguishable, because one is a report and the other is a failure.
async function read_release_plan(
	current_version: string,
	reader: HistoryReader = git_reader,
	tip: string = DEFAULT_TIP,
): Promise<ReleasePlan | undefined> {
	const base = await read_base(reader, tip)

	if (base === undefined) return undefined

	const pending = await reader.count_merges(`${base}..${tip}`)

	return {
		base,
		pending,
		current_version,
		next_version: release_plan.next_version(current_version, pending),
	}
}

const release_history = {
	parse_version,
	read_base,
	read_release_plan,
	BASE_SEARCH_LIMIT,
	DEFAULT_TIP,
}

export { release_history }
export type { HistoryReader }
