// A single-token "did you mean" for `josh <typo>`. The command set is small and the input is one
// word, so a character edit distance is the right measure here — unlike `issue-scout`'s token-set
// Dice similarity, which compares multi-word issue titles (joshuafolkken/kit#1928).
const MAX_SUGGESTION_DISTANCE = 3

// A cell of the matrix, defaulting the out-of-range read to 0. Reading through it keeps the nullish
// guards out of `fill_distance_row`, where they would each count against its complexity limit.
function at(values: ReadonlyArray<number>, index: number): number {
	return values[index] ?? 0
}

// One row of the Levenshtein matrix, built from the previous row. Kept a function of its own so the
// distance itself stays a single loop rather than two nested ones.
function fill_distance_row(
	source: string,
	target: string,
	row: number,
	previous: ReadonlyArray<number>,
): Array<number> {
	const current = [row]

	for (let col = 1; col <= target.length; col++) {
		const cost = source[row - 1] === target[col - 1] ? 0 : 1
		const deletion = at(previous, col) + 1
		const insertion = at(current, col - 1) + 1
		const substitution = at(previous, col - 1) + cost

		current.push(Math.min(deletion, insertion, substitution))
	}

	return current
}

function edit_distance(source: string, target: string): number {
	let previous = Array.from({ length: target.length + 1 }, (_unused, index) => index)

	for (let row = 1; row <= source.length; row++) {
		previous = fill_distance_row(source, target, row, previous)
	}

	return at(previous, target.length)
}

// The closest command name to `input`, or undefined when nothing is within `MAX_SUGGESTION_DISTANCE`
// — a wrong guess is worse than none, so a distant match is dropped rather than shown.
function closest_command(input: string, commands: ReadonlyArray<string>): string | undefined {
	const within = commands
		.map((command) => ({ command, distance: edit_distance(input, command) }))
		.filter((scored) => scored.distance <= MAX_SUGGESTION_DISTANCE)
		.toSorted((left, right) => left.distance - right.distance)

	return within[0]?.command
}

const command_suggest = { closest_command, edit_distance }

export { command_suggest, MAX_SUGGESTION_DISTANCE }
