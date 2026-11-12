import { describe, expect, it } from 'vitest'
import { shell_segments } from './shell-segments'

// joshuafolkken/kit#1510: the cut two triggers share. Cut too eagerly it splits a `--jq` filter into
// fragments no trigger can anchor on; cut too little and a command hidden behind `&&` is never seen.

const FIRST = 'a'
const SECOND = 'b'
const BOTH: ReadonlyArray<string> = [FIRST, SECOND]
const LONE_COMMAND = 'pnpm josh gate'
const QUOTED_SEPARATOR = "echo 'x && y'"

describe('joined_continuations', () => {
	it('joins a backslash-continued line into one command', () => {
		expect(shell_segments.joined_continuations('gh pr comment 5 \\\n-R o/r')).toBe(
			'gh pr comment 5  -R o/r',
		)
	})

	it('leaves a plain newline a separator', () => {
		expect(shell_segments.joined_continuations(`${FIRST}\n${SECOND}`)).toBe(`${FIRST}\n${SECOND}`)
	})
})

describe('segments_of', () => {
	it.each([
		[LONE_COMMAND, [LONE_COMMAND]],
		[`${FIRST} && ${SECOND}`, BOTH],
		[`${FIRST} || ${SECOND}`, BOTH],
		[`${FIRST}; ${SECOND}`, BOTH],
		[`${FIRST}\n${SECOND}`, BOTH],
	])('cuts %j', (command, expected) => {
		expect(shell_segments.segments_of(command)).toStrictEqual(expected)
	})

	// **The one character that is deliberately not a separator.** A `--jq` filter carries it far more
	// often than a command boundary does, and cutting there leaves neither half command-shaped.
	it('leaves a pipe uncut', () => {
		const command = "gh api repos/o/r/issues --jq '.[] | .title'"

		expect(shell_segments.segments_of(command)).toStrictEqual([command])
	})
})

// joshuafolkken/kit#7334: a compound command's opening word is a cut, so the command after it starts a
// segment a rule anchored at `^` reads.
describe('compound commands', () => {
	it.each([
		['case $x in a) rm -rf y;; b) ls;; esac', ['case $x in', 'rm -rf y', '', 'ls', 'esac']],
		['case "$x" in a) rm -rf y;& *) ls;;& esac', ['case "$x" in', 'rm -rf y', '', 'ls', 'esac']],
		['f() { rm -rf y; }', ['f()', 'rm -rf y', '}']],
		['{ rm -rf y; ls; }', ['', 'rm -rf y', 'ls', '}']],
	])('cuts %j', (command, expected) => {
		expect(shell_segments.segments_of(command)).toStrictEqual(expected)
	})

	it.each([["gh api --jq '{ a: .b }'"], ['echo { x'], ['echo in a)']])(
		'leaves a `{` or `)` that opens nothing in %j as text',
		(command) => {
			expect(shell_segments.segments_of(command)).toStrictEqual([command])
		},
	)

	it('cuts a substitution at its `;` but reads its closing `)` as no pattern', () => {
		expect(shell_segments.segments_of('x=$(a; b)')).toStrictEqual(['x=$(a', 'b)'])
	})

	it('cuts a function body on the quote-aware reading too', () => {
		expect(shell_segments.quote_aware_commands_of("f() { echo 'a; b' | rm -rf y; }")).toStrictEqual(
			['f()', "echo 'a; b'", 'rm -rf y', '}'],
		)
	})
})

describe('parts_of', () => {
	it.each([['a && b; c'], ['case $x in a) b;; esac'], ['f() { a; }']])(
		'keeps each cut so the parts of %j join back to the line',
		(command) => {
			expect(shell_segments.parts_of(command).join('')).toBe(command)
		},
	)

	it('keeps the separator between its commands', () => {
		expect(shell_segments.parts_of('a && b')).toStrictEqual(['a ', '&&', ' b'])
	})
})

describe('first_of', () => {
	it.each([
		[LONE_COMMAND, LONE_COMMAND],
		[`${FIRST} && ${SECOND}`, FIRST],
		[`${QUOTED_SEPARATOR} && ${SECOND}`, QUOTED_SEPARATOR],
	])('takes the first command of %j, a quoted separator left uncut', (command, expected) => {
		expect(shell_segments.first_of(command)).toBe(expected)
	})

	it('answers nothing for a heredoc line', () => {
		expect(shell_segments.first_of("cat > f <<'EOF'\na && b\nEOF")).toBeUndefined()
	})

	it('trims each segment so a caller may anchor at the command position', () => {
		expect(shell_segments.segments_of(`  ${FIRST}  &&   ${SECOND} `)).toStrictEqual(BOTH)
	})
})

// joshuafolkken/kit#4038: the argv-reading rows cut at the pipe and the background `&` too, and never
// at a `&` that belongs to a redirection.
describe('commands_of', () => {
	it.each([
		[`${FIRST} && ${SECOND}`, BOTH],
		[`${FIRST} | ${SECOND}`, BOTH],
		[`${FIRST} |& ${SECOND}`, BOTH],
		[`${FIRST} & ${SECOND}`, BOTH],
		[`${FIRST} 2>&1 | ${SECOND}`, [`${FIRST} 2>&1`, SECOND]],
		[`${FIRST} &> log`, [`${FIRST} &> log`]],
		[`${FIRST} >&2`, [`${FIRST} >&2`]],
	])('cuts %j', (command, expected) => {
		expect(shell_segments.commands_of(command)).toStrictEqual(expected)
	})
})

// joshuafolkken/kit#4091: the same cut, never inside a quoted argument.
describe('quote_aware_commands_of', () => {
	it.each([
		[`${FIRST} && ${SECOND}`, BOTH],
		[`${FIRST} | ${SECOND}`, BOTH],
		[`${FIRST} 2>&1 | ${SECOND}`, [`${FIRST} 2>&1`, SECOND]],
		[`grep -E "x|y" f; ${SECOND}`, ['grep -E "x|y" f', SECOND]],
		[`${QUOTED_SEPARATOR} | ${SECOND}`, [QUOTED_SEPARATOR, SECOND]],
		[`${FIRST};`, [FIRST, '']],
	])('cuts %j', (command, expected) => {
		expect(shell_segments.quote_aware_commands_of(command)).toStrictEqual(expected)
	})

	it('falls back to commands_of for a heredoc line', () => {
		const command = "cat > f <<'EOF'\na | b\nEOF"

		expect(shell_segments.quote_aware_commands_of(command)).toStrictEqual(
			shell_segments.commands_of(command),
		)
	})
})
