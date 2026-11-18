import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { find_package_directory } from '#scripts/josh/josh-logic'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_brief } from './review-brief'
import { review_rubric_sections } from './review-rubric-sections'

// The rubric file a brief names: a copy holding only the sections this diff needs
// (`review-rubric-sections.ts`), or the whole rubric when none can go or the copy cannot be written.
// Named by its own digest, so two briefs composed at once never overwrite a copy another reviewer
// is about to read.
const PREFIX = 'josh-review-rubric-'
const SUFFIX = '.md'
const DIGEST_LENGTH = 16

// The whole rubric's absolute path, resolved against the kit package rather than the review checkout
// root. The rubric ships inside the package, so a consumer that keeps no `prompts/` of its own still
// receives it at `node_modules/@joshuafolkken/kit/prompts/`. `find_package_directory` ascends to the
// nearest package.json, so this resolves from both the tsx source and the bundled `dist/josh.js`.
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.join(
	find_package_directory(MODULE_DIRECTORY),
	review_brief.RUBRIC_RELATIVE_PATH,
)

function copy_path(root: string, text: string): string {
	return stamp_file.stamp_path(
		`${PREFIX}${stamp_file.digest(text).slice(0, DIGEST_LENGTH)}-`,
		root,
		SUFFIX,
	)
}

// **Any failure answers with the whole rubric's path**: a reviewer handed every section is the safe
// side, and the brief must still name a file that exists. `source` is a parameter for the tests only.
function path_for(
	root: string,
	paths: ReadonlyArray<string>,
	round: number,
	source: string = SOURCE_PATH,
): string {
	try {
		const text = readFileSync(source, 'utf8')
		const trimmed = review_rubric_sections.trim(text, paths, round)

		if (trimmed === text) return source

		return stamp_file.replace_text_stamp(copy_path(root, trimmed), trimmed)
	} catch {
		return source
	}
}

const review_rubric_file = { path_for, PREFIX, SOURCE_PATH }

export { review_rubric_file }
