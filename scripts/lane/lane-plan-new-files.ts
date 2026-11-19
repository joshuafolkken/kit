// The floor a plan's new files put under `lane:plan`'s lines axis (joshuafolkken/kit#8120): a plan names
// its new files but not their size, and the declaration times the period's ratio left them out — #7974
// declared 170 lines and shipped 433 with two new modules of 229 and 94 lines. Each planned file the base
// does not hold counts at least this many lines, the mean of those two; with no base listing none is new.
const LINES_PER_NEW_FILE = 160

// `counted` are the plan's counted files (tests excluded); a directory claim is not one new file.
function new_files_of(
	counted: ReadonlyArray<string>,
	base_files: ReadonlySet<string> | undefined,
): Array<string> {
	if (base_files === undefined) return []

	return counted.filter((file) => !file.endsWith('/') && !base_files.has(file))
}

function floor_lines(new_files: number): number {
	return new_files * LINES_PER_NEW_FILE
}

function floor_text(new_files: number): string {
	return `its ${String(new_files)} new file(s) floor it at ${String(floor_lines(new_files))} (${String(LINES_PER_NEW_FILE)} lines each)`
}

const lane_plan_new_files = { floor_lines, floor_text, new_files_of }

export { lane_plan_new_files }
