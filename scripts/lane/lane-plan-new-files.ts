import { backlog_overlap } from '#scripts/backlog/backlog-overlap'

// The floor a plan's new files put under `lane:plan`'s lines axis (joshuafolkken/kit#8120): a plan names
// its new files but not their size, and the declaration times the period's ratio left them out — #7974
// declared 170 lines and shipped 433 with two new modules of 229 and 94 lines. Each planned file the base
// does not hold counts at least this many lines, the mean of those two; with no base listing none is new.
const LINES_PER_NEW_FILE = 160

// `counted` are the plan's counted files (tests excluded); a directory or glob claim is not one new file.
function new_files_of(
	counted: ReadonlyArray<string>,
	base_files: ReadonlySet<string> | undefined,
): Array<string> {
	if (base_files === undefined) return []

	return counted.filter((file) => backlog_overlap.is_file_claim(file) && !base_files.has(file))
}

// The floor a lines overrun carries: the new files and the bar in grown lines it was compared against.
interface NewFilesFloor {
	files: number
	grown_limit: number
}

function floor_lines(new_files: number): number {
	return new_files * LINES_PER_NEW_FILE
}

// No new file, no floor to name.
function floor_of(new_files: number, grown_limit: number): NewFilesFloor | undefined {
	return new_files === 0 ? undefined : { files: new_files, grown_limit }
}

function floor_text(floor: NewFilesFloor): string {
	return `its ${String(floor.files)} new file(s) floor it at ${String(floor_lines(floor.files))} (${String(LINES_PER_NEW_FILE)} lines each) against the ${String(floor.grown_limit)} grown lines the bar allows`
}

const lane_plan_new_files = { floor_lines, floor_of, floor_text, new_files_of }

export { lane_plan_new_files }
export type { NewFilesFloor }
