import { describe, expect, it } from 'vitest'
import { format_replaced_relations } from './git-epic-reference'

// joshuafolkken/kit#1711: the sentence a positioned `epic --add` prints and writes into its
// `--decision-file` record, naming the `blocked-by` relations it discarded.
//
// It is pinned here rather than only through the command, because the case the wording exists for is
// the one the command test cannot show cheaply: a relocation drops **two** links at once, and one
// code span around the whole list renders them as a single malformed chain in the record that
// outlives the console.

const FIRST = { blocker: 890, blocked: 891 }
const SECOND = { blocker: 891, blocked: 892 }

describe('format_replaced_relations', () => {
	it('backticks a single chain', () => {
		expect(format_replaced_relations([FIRST])).toBe('Replaced blocked-by: `#890 -> #891`.')
	})

	it('gives each chain its own code span', () => {
		expect(format_replaced_relations([FIRST, SECOND])).toBe(
			'Replaced blocked-by: `#890 -> #891`, `#891 -> #892`.',
		)
	})
})
