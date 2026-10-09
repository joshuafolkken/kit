// The change handed to the reviewer as files no larger than the Bash output cap.
// A print past `BASH_MAX_OUTPUT_LENGTH` comes back as a truncated preview plus a saved file the
// reviewer then re-reads, and both stay in the cached prefix of every later request.
//
// **The diff is split, not shortened.** Each changed path gets its own parts, every part fits under the
// cap, and the parts of one path concatenate back to exactly its diff — so the scope a review covers
// is the one `git diff` lists, and only the size of a single read changes.

// A map from each changed path to the absolute part files that carry its diff, in order.
type DiffParts = Readonly<Record<string, ReadonlyArray<string>>>

const LINE_BREAK = '\n'

// A line longer than the budget is cut by characters: a minified file or a lockfile line would
// otherwise produce one part past the cap, which is the read this module exists to remove.
function cut_line(line: string, budget: number): Array<string> {
	const pieces: Array<string> = []

	for (let start = 0; start < line.length; start += budget) {
		pieces.push(line.slice(start, start + budget))
	}

	return pieces
}

function pieces_of(text: string, budget: number): Array<string> {
	return text.split(/(?<=\n)/u).flatMap((line) => cut_line(line, budget))
}

// Line-preserving where a line fits, so a part ends on a line boundary and a reader never sees a hunk
// cut mid-line unless that one line is itself over the budget.
function is_full(current: string, piece: string, budget: number): boolean {
	return current.length > 0 && current.length + piece.length > budget
}

function split_text(text: string, budget: number): Array<string> {
	const parts: Array<string> = []
	let current = ''

	for (const piece of pieces_of(text, budget)) {
		if (is_full(current, piece, budget)) {
			parts.push(current)
			current = ''
		}

		current += piece
	}

	return current.length > 0 ? [...parts, current] : parts
}

function part_header(relative: string, index: number, count: number): string {
	return `# ${relative} — part ${String(index + 1)} of ${String(count)}${LINE_BREAK}`
}

// The header is counted inside the cap, so the file a reader opens — header included — is what fits.
// The count in the header is the final one, so it is sized against the widest header it can carry.
function part_texts(relative: string, diff: string, cap: number): Array<string> {
	const budget = Math.max(1, cap - part_header(relative, diff.length, diff.length).length)
	const bodies = split_text(diff, budget)

	return bodies.map((body, index) => `${part_header(relative, index, bodies.length)}${body}`)
}

function body_of(part: string): string {
	return part.slice(part.indexOf(LINE_BREAK) + 1)
}

function part_list(parts: DiffParts): string {
	return Object.entries(parts)
		.flatMap(([relative, files]) => [`  ${relative}`, ...files.map((file) => `    ${file}`)])
		.join(LINE_BREAK)
}

// **The read instruction names the tool as well as the files.** A part under the cap would survive a
// `cat`, but the Read tool is the one read that is never truncated, and naming it keeps the reviewer
// from reaching back for the whole `git diff` the target line defines the change by.
function reading_block(parts: DiffParts, cap: number): string {
	return [
		`Reading the diff: Bash output is cut at ${String(cap)} characters, so the change is written below as one or more parts per path, each under that cap, and together exactly the diff. Read the parts of every path you review with the Read tool. Do not print the diff, or any file this brief names, through Bash (\`git diff\`, \`cat\`).`,
		part_list(parts),
	].join(LINE_BREAK)
}

const review_diff_parts = { body_of, part_texts, reading_block, split_text }

export { review_diff_parts, type DiffParts }
