import { describe, expect, it } from 'vitest'
import { run_step } from './run-step'
import { run_step_section_table } from './run-step-section-table'

const { CUT, ENTRY, GOVERNING_SECTIONS, LANE_CHILD_SECTIONS, PARK, PAUSE, PROGRESS, RESUME } =
	run_step_section_table

describe('run_step_section_table — the keys the commands print under', () => {
	it.each([ENTRY, PROGRESS, CUT, RESUME, PARK, PAUSE])('keeps a governing row for %s', (key) => {
		expect(GOVERNING_SECTIONS.get(key)).toBeDefined()
	})

	it('hands a lane child its own step of the chain', () => {
		expect(LANE_CHILD_SECTIONS.get(run_step.IMPLEMENT)?.heading).toBe('A lane child')
	})
})
