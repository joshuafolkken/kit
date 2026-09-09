import { describe, expect, it } from 'vitest'
import { shell_segments } from './shell-segments'

// joshuafolkken/kit#1510: the cut two triggers share. Cut too eagerly it splits a `--jq` filter into
// fragments no trigger can anchor on; cut too little and a command hidden behind `&&` is never seen.

const FIRST = 'a'
const SECOND = 'b'
const BOTH: ReadonlyArray<string> = [FIRST, SECOND]
const LONE_COMMAND = 'pnpm josh gate'

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

	it('trims each segment so a caller may anchor at the command position', () => {
		expect(shell_segments.segments_of(`  ${FIRST}  &&   ${SECOND} `)).toStrictEqual(BOTH)
	})
})
