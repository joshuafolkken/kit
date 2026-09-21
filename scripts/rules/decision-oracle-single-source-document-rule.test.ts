import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2254: every decision oracle declares the `single_source` document that carries its
// decision procedure, but no test ever opened that document — `decision-oracle.test.ts` only asserted
// the field is a non-empty string. So a `single_source` could point at a document that has stopped
// carrying the procedure (a manifest cut back to pointers, a section renamed) and nothing would fail.
//
// This is the same shape #2251 built for the run:step driver alone (`ordering-question-document-rule.test.ts`),
// generalized to all 29 oracles: a document that answers a decision through an oracle carries a pointer
// to the command, not the branch procedure the command computes — so its single source must at least
// name the command a reader is routed to. The check is derived from `DECISION_ORACLES`, so one more
// oracle grows the checked set by one without a hand-written phrase table.

// A `single_source` is written `file.md → section`; the pointer check reads the whole file, exactly as
// #2251 reads a whole manifest, so the section suffix is dropped to resolve the path.
const SECTION_SEPARATOR = '→'

function single_source_path(single_source: string): string {
	const [path = single_source] = single_source.split(SECTION_SEPARATOR)

	return path.trim()
}

describe('every oracle single source names the command it routes to', () => {
	// The pointer the residency rule requires: a decision answered by a command names that command in
	// its single source rather than re-narrating the verdict-by-verdict procedure the command computes.
	// This is what catches a `single_source` left pointing at a document the procedure has moved out of.
	it.each(decision_oracle.DECISION_ORACLES)('$name — $single_source names `$name`', (oracle) => {
		const path = single_source_path(oracle.single_source)
		const command = decision_oracle.get_command(oracle)

		expect(read_unwrapped(path)).toContain(command)
	})
})
