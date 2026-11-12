import { run_step_section } from '#scripts/run/run-step-section'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_section } from './followup-section'

const SUCCESS = 0
const FAILURE = 1
const ROOT = '/repo'

beforeEach(() => {
	vi.spyOn(run_step_section, 'print_once').mockReturnValue(SUCCESS)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('followup_section.print_section — followup prints its governing section', () => {
	it('prints the followup row once per session in a session that typed it', () => {
		followup_section.print_section(ROOT, {})

		expect(run_step_section.print_once).toHaveBeenCalledExactlyOnceWith('followup', ROOT)
	})

	it('prints nothing in a followup a ship runs, whose env carries the ship marker', () => {
		followup_section.print_section(ROOT, { ...followup_section.SHIPPED_ENVIRONMENT })

		expect(run_step_section.print_once).not.toHaveBeenCalled()
	})

	it('prints the section without the ship marker, whatever else the env carries', () => {
		followup_section.print_section(ROOT, { JOSH_SHIP_SUPERVISED: '1' })

		expect(run_step_section.print_once).toHaveBeenCalledOnce()
	})

	it('fails the command when the section does not resolve', () => {
		vi.mocked(run_step_section.print_once).mockReturnValue(FAILURE)

		expect(() => {
			followup_section.print_section(ROOT, {})
		}).toThrow(followup_section.UNRESOLVED_MESSAGE)
	})
})
