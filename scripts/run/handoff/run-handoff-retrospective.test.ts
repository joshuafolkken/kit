import { describe, expect, it } from 'vitest'
import { run_handoff_retrospective } from './run-handoff-retrospective'

// joshuafolkken/kit#6743: the unit's brief is `retrospective.md`'s procedure, in its order.

const { CLOSE_COMMAND, DIGEST_COMMAND, FILE_COMMAND } = run_handoff_retrospective

describe('run_handoff_retrospective.brief', () => {
	it('points the unit at retrospective.md', () => {
		expect(run_handoff_retrospective.brief()).toContain('workflow-commands/retrospective.md')
	})

	it('runs the digest, files through issue:file, stacks the rest and closes with the carry mark, in order', () => {
		const brief = run_handoff_retrospective.brief()
		const steps = [DIGEST_COMMAND, 'The depth test', FILE_COMMAND, '`stack:`', CLOSE_COMMAND]
		const positions = steps.map((step) => brief.indexOf(step))

		expect(positions).not.toContain(-1)
		expect(positions).toEqual(positions.toSorted((left, right) => left - right))
	})

	// The carry is the parent's, so the unit's close names the parent as owner or is refused.
	it('names the given owner on the close, and leaves --owner out when none is known', () => {
		const owned = `${CLOSE_COMMAND} ${run_handoff_retrospective.OWNER_FLAG} 4242 --summary`

		expect(run_handoff_retrospective.brief(4242)).toContain(owned)
		expect(run_handoff_retrospective.brief()).toContain(`${CLOSE_COMMAND} --summary`)
	})
})
