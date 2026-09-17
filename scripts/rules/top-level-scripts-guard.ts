import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `scripts/` is grouped into domain subdirectories (joshuafolkken/kit#2013). A file placed directly
// under `scripts/` is what this guard forbids: flat files are hard to find, coarsen the changed-file
// scope, and inflate an agent's investigation reads. The scripts root is one level above this rule's
// own directory.
const SCRIPTS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// The extensions a top-level file would carry — every executable script is one of these. A stray
// `.md` or `.json` at the root is not what the layout is about, so it is not guarded.
const GUARDED_EXTENSIONS: ReadonlyArray<string> = ['.ts', '.sh']

// Files permitted directly under `scripts/`. Empty today — every script lives in a domain
// subdirectory — so a new top-level file is a mistake until someone adds it here with a reason.
const TOP_LEVEL_ALLOWLIST: ReadonlySet<string> = new Set<string>()

function is_guarded_file(name: string): boolean {
	return GUARDED_EXTENSIONS.some((extension) => name.endsWith(extension))
}

// The guarded top-level names that are not allowlisted. Kept pure over a plain listing so its own
// unit test can exercise it without touching the filesystem.
function top_level_offenders(
	entries: ReadonlyArray<string>,
	allowlist: ReadonlySet<string> = TOP_LEVEL_ALLOWLIST,
): Array<string> {
	return entries.filter((name) => is_guarded_file(name) && !allowlist.has(name))
}

// The real names sitting directly under `scripts/`, files only — subdirectories are the whole point
// of the layout, so they are never offenders.
function read_top_level_entries(): Array<string> {
	return readdirSync(SCRIPTS_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
}

const top_level_scripts_guard = {
	SCRIPTS_ROOT,
	TOP_LEVEL_ALLOWLIST,
	top_level_offenders,
	read_top_level_entries,
}

export { top_level_scripts_guard }
