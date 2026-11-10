import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_diff_pack, type Bundle } from './review-diff-pack'
import { review_diff_parts, type DiffParts } from './review-diff-parts'

// Writes the change as the parts `review-diff-parts.ts` cuts it into, packed into as few files as
// the cap allows (`review-diff-pack.ts`).
//
// **One diff per path, read the way the target line defines the change** — `git -C <root> diff
// <base> -- <path>` for a tracked path, and the file's own content for an untracked one, which no
// `git diff` lists. The parts are written to the temp directory keyed per checkout, the same place the
// brief's other records live, and the directory is replaced on every brief so a part from an earlier
// tree is never offered beside this one's.

const DIRECTORY_PREFIX = 'josh-review-diff-'
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const PART_SUFFIX = '.diff'
const INDEX_WIDTH = 3
const NUL = '\0'
const SLUG_SEPARATOR = '__'

function untracked_text(root: string, relative: string): string {
	try {
		const content = readFileSync(path.join(root, relative), 'utf8')

		if (content.includes(NUL)) return `untracked binary file ${relative}, not shown\n`

		return `untracked file ${relative}, shown whole:\n${content}`
	} catch {
		return `${relative} is listed by the change but holds no diff and no file\n`
	}
}

async function path_diff(root: string, base: string, relative: string): Promise<string> {
	const diff = await git_spawn.read(['-C', root, 'diff', '--no-color', base, '--', relative])

	return diff.length > 0 ? diff : untracked_text(root, relative)
}

// A packed file is named after the first path it carries; the position keeps the names unique and
// in the order the files join back to the change.
function part_name(position: number, bundle: Bundle): string {
	const prefix = String(position).padStart(INDEX_WIDTH, '0')
	const [first = ''] = bundle.paths

	return `${prefix}-${first.split('/').join(SLUG_SEPARATOR)}${PART_SUFFIX}`
}

function write_bundle(directory: string, bundle: Bundle, position: number): string {
	const file = path.join(directory, part_name(position, bundle))

	writeFileSync(file, bundle.text, { flag: 'wx', mode: FILE_MODE })

	return file
}

function fresh_directory(root: string): string {
	const directory = stamp_file.stamp_path(DIRECTORY_PREFIX, root, '')

	rmSync(directory, { recursive: true, force: true })
	mkdirSync(directory, { mode: DIRECTORY_MODE })

	return directory
}

interface DiffRequest {
	root: string
	base: string
	paths: ReadonlyArray<string>
	cap: number
}

async function write_parts(request: DiffRequest, directory?: string): Promise<DiffParts> {
	const { root, base, paths, cap } = request
	const texts = await Promise.all(
		paths.map(async (relative) => ({ relative, text: await path_diff(root, base, relative) })),
	)
	const target = directory ?? fresh_directory(root)
	const entries = texts.map(({ relative, text }) => ({
		relative,
		parts: review_diff_parts.part_texts(relative, text, cap),
	}))
	const bundles = review_diff_pack.pack(entries, cap)

	return review_diff_pack.parts_of(
		bundles.map((bundle, position) => ({
			file: write_bundle(target, bundle, position),
			paths: bundle.paths,
		})),
	)
}

const review_diff_write = { path_diff, write_parts }

export { review_diff_write }
