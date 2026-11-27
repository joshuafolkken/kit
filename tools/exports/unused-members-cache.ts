import { readFileSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { stamp_file } from '#scripts/josh/stamp-file'
import { atomic_write } from '#scripts/lib/atomic-write'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { z } from 'zod'

const CACHE_FILE = 'unused-members-cache.json'
const LOCKFILE = 'pnpm-lock.yaml'
// A file the scan loaded that cannot be read now digests to this, so it stays current while absent.
const UNREADABLE = ''

const MEMBER_SCHEMA = z.object({
	namespace: z.string(),
	member: z.string(),
	file: z.string(),
	line: z.number(),
})

const ENTRY_SCHEMA = z.object({
	key: z.string(),
	files: z.record(z.string(), z.string()),
	members: z.array(MEMBER_SCHEMA),
})

type ReportedMember = z.infer<typeof MEMBER_SCHEMA>
type CacheEntry = z.infer<typeof ENTRY_SCHEMA>

interface UnusedMembersScan {
	members: ReadonlyArray<ReportedMember>
	files: ReadonlyArray<string>
}

function file_digest(file: string): string {
	try {
		return stamp_file.digest(readFileSync(file))
	} catch {
		return UNREADABLE
	}
}

// The scan's inputs and the installed dependencies: a lockfile change can retype any loaded file.
function cache_key(root: string, inputs: unknown): string {
	const lock = file_reader.read_if_readable(path.join(root, LOCKFILE)) ?? UNREADABLE

	return stamp_file.digest(`${JSON.stringify(inputs)}\0${lock}`)
}

function read_entry(cache_file: string): CacheEntry | undefined {
	const text = file_reader.read_if_readable(cache_file)

	return text === undefined ? undefined : json_value.parse_with(text, ENTRY_SCHEMA)
}

function is_current(entry: CacheEntry, key: string): boolean {
	if (entry.key !== key) return false

	return Object.entries(entry.files).every(([file, digest]) => file_digest(file) === digest)
}

// A failed write only costs the next run a scan.
function record(cache_file: string, key: string, scan: UnusedMembersScan): void {
	const entry: CacheEntry = {
		key,
		files: Object.fromEntries(scan.files.map((file) => [file, file_digest(file)])),
		members: scan.members.map((member) => MEMBER_SCHEMA.parse(member)),
	}

	try {
		atomic_write.replace_file(cache_file, JSON.stringify(entry))
	} catch {
		// Left uncached.
	}
}

// The last scan's members while its inputs, the lockfile and every file its program loaded are
// unchanged; otherwise a fresh scan, remembered per clone. Outside a git checkout it always scans.
function reuse(
	root: string,
	inputs: unknown,
	scan: () => UnusedMembersScan,
): ReadonlyArray<ReportedMember> {
	const directory = git_common_directory.own(root)
	if (directory === undefined) return scan().members
	const cache_file = path.join(directory, git_common_directory.STATE_DIRECTORY, CACHE_FILE)
	const key = cache_key(root, inputs)
	const entry = read_entry(cache_file)
	if (entry !== undefined && is_current(entry, key)) return entry.members
	const result = scan()

	record(cache_file, key, result)

	return result.members
}

const unused_members_cache = { reuse }

export { unused_members_cache }
export type { ReportedMember, UnusedMembersScan }
