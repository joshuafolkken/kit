import path from 'node:path'

// The lines a plan's file moves add to `lane:plan`'s lines axis (joshuafolkken/kit#8119): the merge
// measures a move as the whole file deleted and added (`git-diff-reads.ts` → `NO_RENAME_DETECTION`), and
// split-assessment.md counts a move twice, but the declaration times the period's ratio left it out —
// #7980 declared 250 lines and shipped 1,904, about 1,200 of them moved. A planned file the base holds
// and a planned file it does not, sharing a file name, read as a move from the first; each source counts
// twice its lines at the base. With no base listing no file reads as moved.
const MOVE_WEIGHT = 2

// `counted` are the plan's counted files (tests excluded); a directory claim moves nothing.
function sources_of(
	counted: ReadonlyArray<string>,
	base_files: ReadonlySet<string> | undefined,
): Array<string> {
	if (base_files === undefined) return []
	const files = counted.filter((file) => !file.endsWith('/'))
	const added = new Set(
		files.filter((file) => !base_files.has(file)).map((file) => path.basename(file)),
	)

	return files.filter((file) => base_files.has(file) && added.has(path.basename(file)))
}

// `source_lines` holds each move source's lines at the base; one it could not read counts as 0.
function moved_lines(
	sources: ReadonlyArray<string>,
	source_lines: ReadonlyMap<string, number> | undefined,
): number {
	const lines = sources.reduce((sum, file) => sum + (source_lines?.get(file) ?? 0), 0)

	return lines * MOVE_WEIGHT
}

function moved_text(moved: number): string {
	return `its planned moves add ${String(moved)} (${String(MOVE_WEIGHT)} times the lines moved)`
}

const lane_plan_moves = { moved_lines, moved_text, sources_of }

export { lane_plan_moves }
