import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { git_path_quoting } from '#scripts/git/git-path-quoting'
import { git_spawn } from '#scripts/git/git-spawn'

interface DeletedBlob {
	file: string
	object: string
}

interface RelocatedDiff {
	numstat: string
	added: ReadonlyArray<string>
}

interface RawChange {
	header: string
	file: string
}

const PAIR_FIELDS = 2
const RAW_OPTIONS = ['diff', '--raw', '-z', '--no-abbrev', '--no-relative', '--no-renames']

function raw_changes(raw: string): Array<RawChange> {
	return raw
		.split('\0')
		.flatMap((header, index, fields) =>
			index % PAIR_FIELDS === 0 && fields[index + 1] !== undefined
				? { header, file: fields[index + 1] ?? '' }
				: [],
		)
}

function deleted_blobs(raw: string): Array<DeletedBlob> {
	return raw_changes(raw).flatMap(({ header, file }) => {
		const object = /^:100\d+ \d+ (\w+) \w+ D$/u.exec(header)?.[1]

		return object === undefined ? [] : { file, object }
	})
}

function added_paths(raw: string): Array<string> {
	return raw_changes(raw)
		.filter((change) => change.header.endsWith(' A'))
		.map((change) => change.file)
}

async function content_object(root: string, file: string): Promise<string | undefined> {
	try {
		const stat = await lstat(path.join(root, file))

		if (!stat.isFile()) return undefined

		return await git_spawn.read(['-C', root, 'hash-object', '--no-filters', '--', file])
	} catch {
		return undefined
	}
}

function pair(deleted: Array<DeletedBlob>, addition: DeletedBlob): Array<string> {
	const index = deleted.findIndex((blob) => blob.object === addition.object)

	if (index === -1) return []

	return deleted.splice(index, 1).flatMap((source) => [source.file, addition.file])
}

function paired_paths(raw: string, additions: ReadonlyArray<DeletedBlob>): ReadonlySet<string> {
	const deleted = deleted_blobs(raw)

	const paths = additions.flatMap((addition) => pair(deleted, addition))

	return new Set(paths.map((file) => git_path_quoting.quote(file)))
}

async function candidates(root: string, files: ReadonlyArray<string>): Promise<Array<DeletedBlob>> {
	return await Promise.all(
		files.map(async (file) => ({
			file,
			object: (await content_object(root, file)) ?? '',
		})),
	)
}

// Exact relocations carry no implementation lines. Each deletion can answer only one addition;
// edited moves and unrelated additions/deletions retain their full numstat contribution. The files
// the branch adds, tracked or not, come back beside it for the split notice's units
// (joshuafolkken/kit#6724).
async function without_relocations(
	root: string,
	base: string,
	numstat: string,
	untracked: ReadonlyArray<string>,
): Promise<RelocatedDiff> {
	const raw = await git_spawn.read([...RAW_OPTIONS, base, '--'])
	const added = [...added_paths(raw), ...untracked]
	const paired = paired_paths(raw, await candidates(root, added))
	const rows = numstat
		.split('\n')
		.filter((row) => !paired.has(row.split('\t').slice(PAIR_FIELDS).join('\t')))

	return { numstat: rows.join('\n'), added }
}

const split_relocations = { without_relocations }

export type { RelocatedDiff }
export { split_relocations }
