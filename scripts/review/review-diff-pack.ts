import type { DiffParts } from './review-diff-parts'

// Packs the per-path parts `review-diff-parts.ts` cuts into as few files as the cap allows
// (joshuafolkken/kit#7044).
//
// **Why pack.** The reviewer Reads every part file, and each Read is one more request that re-reads
// the cached brief and diff. One file per path made a ten-path change ten Reads although most path
// diffs are a fraction of the cap. Consecutive parts share a file while it stays within the cap.
//
// **Nothing is cut or reordered.** Each part keeps its own `# <path> — part i of n` header, so a
// shared file still says which path each hunk belongs to, and the files joined in order are exactly
// the parts joined in order — the scope a review covers is unchanged; only the number of reads is.

interface PathParts {
	relative: string
	parts: ReadonlyArray<string>
}

interface Bundle {
	text: string
	paths: Array<string>
}

interface WrittenBundle {
	file: string
	paths: ReadonlyArray<string>
}

function fits(bundle: Bundle | undefined, part: string, cap: number): bundle is Bundle {
	return bundle !== undefined && bundle.text.length + part.length <= cap
}

function add(bundles: Array<Bundle>, relative: string, part: string, cap: number): void {
	const last = bundles.at(-1)

	if (!fits(last, part, cap)) {
		bundles.push({ text: part, paths: [relative] })

		return
	}

	last.text += part
	if (last.paths.at(-1) !== relative) last.paths.push(relative)
}

function pack(entries: ReadonlyArray<PathParts>, cap: number): Array<Bundle> {
	const bundles: Array<Bundle> = []

	for (const entry of entries) {
		for (const part of entry.parts) add(bundles, entry.relative, part, cap)
	}

	return bundles
}

// Each path maps to every file holding one of its parts, in order, so a shared file is listed under
// each path it carries.
function parts_of(written: ReadonlyArray<WrittenBundle>): DiffParts {
	const parts: Record<string, Array<string>> = {}

	for (const { file, paths } of written) {
		for (const relative of paths) parts[relative] = [...(parts[relative] ?? []), file]
	}

	return parts
}

const review_diff_pack = { pack, parts_of }

export { review_diff_pack, type Bundle, type PathParts }
