import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { comment_ranges, type TypeScriptApi } from './comment-ranges'
import { import_specifiers } from './import-specifiers'
import { review_stamps } from './review-stamps'

// The second map round 1 records beside `review-tree.ts`'s: for each source file, the digest of its
// text with the comments taken out (joshuafolkken/kit#3826).
//
// **Why a second record rather than a second reading of the first.** The round-1 snapshot holds
// digests, not text, so it cannot reconstruct a changed `.ts` file's original contents. A
// comment-free digest taken at the same moment is what lets round 2 tell "only the comments changed"
// from "the code changed" — equal digests mean equal code.
//
// **`.claude/` is outside it**: the decision on joshuafolkken/kit#3787 left `.claude/**` reviewed in
// full, comments included.
//
// **TypeScript is resolved from the project, and its absence records nothing.** It is an optional peer
// of this package, and a missing map is a comment-only arm that never fires — a round run, never one
// skipped.

const SCRIPT_EXTENSIONS: ReadonlyArray<string> = ['.ts', '.js']
const SVELTE_EXTENSION = '.svelte'
const EXCLUDED_PREFIX = '.claude/'
const TYPESCRIPT_MODULE = 'typescript'

function is_svelte(relative: string): boolean {
	return relative.endsWith(SVELTE_EXTENSION)
}

function is_source(relative: string): boolean {
	if (relative.startsWith(EXCLUDED_PREFIX)) return false

	return is_svelte(relative) || SCRIPT_EXTENSIONS.some((extension) => relative.endsWith(extension))
}

function load_typescript(root: string): TypeScriptApi | undefined {
	try {
		return createRequire(path.join(root, PACKAGE_JSON))(TYPESCRIPT_MODULE) as TypeScriptApi
	} catch {
		return undefined
	}
}

type Digest = (text: string, relative: string) => string | undefined

function text_digest(api: TypeScriptApi, text: string, relative: string): string | undefined {
	const code = comment_ranges.strip(api, text, is_svelte(relative))

	return code === undefined ? undefined : stamp_file.digest(code)
}

// The digest that also leaves out where each binding is imported from (joshuafolkken/kit#5789).
function inert_digest(api: TypeScriptApi): Digest {
	return (text, relative) =>
		text_digest(api, import_specifiers.blank(api, text, relative), relative)
}

function code_digest(digest: Digest, root: string, relative: string): string | undefined {
	try {
		return digest(readFileSync(path.join(root, relative), 'utf8'), relative)
	} catch {
		return undefined
	}
}

// A path absent at `base` (a new file) or that does not parse there has no digest. `git show`'s
// output arrives with its final newline stripped, which the working-tree file still ends in.
async function base_digest(
	digest: Digest,
	base: string,
	relative: string,
): Promise<string | undefined> {
	try {
		const text = await git_command.show_file(`${base}:${relative}`)

		return digest(`${text}\n`, relative)
	} catch {
		return undefined
	}
}

function digests_of(
	root: string,
	paths: ReadonlyArray<string>,
	digest: Digest,
): Record<string, string> {
	const entries = paths
		.filter((relative) => is_source(relative))
		.flatMap((relative) => {
			const value = code_digest(digest, root, relative)

			return value === undefined ? [] : [[relative, value] as const]
		})

	return Object.fromEntries(entries)
}

// A path that is deleted, does not parse, or is not a source file has no entry — and a path with no
// entry is never comment-only.
function tree_of(
	root: string,
	paths: ReadonlyArray<string>,
	api: TypeScriptApi | undefined = load_typescript(root),
): Record<string, string> {
	if (api === undefined) return {}

	return digests_of(root, paths, (text, relative) => text_digest(api, text, relative))
}

async function read(paths: ReadonlyArray<string>, root?: string): Promise<Record<string, string>> {
	return tree_of(root ?? (await git_command.repository_root()), paths)
}

// Written only in the same brief that wrote the round-1 snapshot, so the two describe one moment. A
// failure removes any earlier record rather than leaving one from another moment beside the new
// snapshot.
async function record(
	paths: ReadonlyArray<string>,
	base: string | undefined,
	target?: string,
	root?: string,
): Promise<void> {
	try {
		review_stamps.round_one_code_stamp.write(await read(paths, root), target, base)
	} catch {
		review_stamps.clear_round_one_code(target)
	}
}

// The paths whose code round 1's fixes left as it was — whose difference, if any, is in comments.
// Against a record taken on another base only `unmoved` qualifies — the paths the move left alone
// (`review_round_one_blobs.unmoved`), where the carried file is round 1's own and equal code digests
// still mean a comment-only fix (joshuafolkken/kit#4165).
function comment_only(
	snapshot: FileMapStamp | undefined,
	tree: Record<string, string>,
	base: string | undefined,
	unmoved: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
	if (snapshot === undefined || base === undefined) return []
	const is_same_base = snapshot.base === base

	return Object.keys(snapshot.files).filter(
		(relative) =>
			snapshot.files[relative] === tree[relative] && (is_same_base || unmoved.includes(relative)),
	)
}

// The paths whose code is what it was at `base` — whose difference from it, if any, is in comments or
// in a binding import's module specifier. Read before round 1 has recorded anything, so it compares
// against the base's blobs rather than a round-1 snapshot (joshuafolkken/kit#5656). Round 1's own
// record keeps the comment-only digest, so round 2 still reads an import a fix moved.
async function inert_since(
	base: string,
	paths: ReadonlyArray<string>,
	root?: string,
	api?: TypeScriptApi,
): Promise<ReadonlyArray<string>> {
	const checkout = root ?? (await git_command.repository_root())
	const typescript = api ?? load_typescript(checkout)
	if (typescript === undefined) return []
	const digest = inert_digest(typescript)
	const tree = digests_of(checkout, paths, digest)
	const sources = Object.keys(tree)
	const digests = await Promise.all(
		sources.map(async (relative) => await base_digest(digest, base, relative)),
	)

	return sources.filter((relative, index) => digests[index] === tree[relative])
}

const review_code_tree = {
	comment_only,
	inert_since,
	load_typescript,
	read,
	record,
	tree_of,
}

export { review_code_tree }
