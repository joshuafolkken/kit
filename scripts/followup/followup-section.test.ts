import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_step_section } from '#scripts/run/run-step-section'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_section } from './followup-section'

const SUCCESS = 0
const FAILURE = 1
const ROOT = '/repo'

beforeEach(() => {
	vi.spyOn(run_step_section, 'print_once').mockReturnValue(SUCCESS)
	vi.spyOn(run_ship_detach, 'is_supervised').mockReturnValue(false)
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('followup_section.print_section — followup prints its governing section', () => {
	it('prints the followup row once per session in a session that typed it', () => {
		followup_section.print_section(ROOT)

		expect(run_step_section.print_once).toHaveBeenCalledExactlyOnceWith('followup', ROOT)
	})

	it('prints nothing under a detached ship supervisor', () => {
		vi.mocked(run_ship_detach.is_supervised).mockReturnValue(true)

		followup_section.print_section(ROOT)

		expect(run_step_section.print_once).not.toHaveBeenCalled()
	})

	it('prints nothing in a lane child, whose ship runs the followup', () => {
		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(true)

		followup_section.print_section(ROOT)

		expect(run_step_section.print_once).not.toHaveBeenCalled()
	})

	it('fails the command when the section does not resolve', () => {
		vi.mocked(run_step_section.print_once).mockReturnValue(FAILURE)

		expect(() => {
			followup_section.print_section(ROOT)
		}).toThrow(followup_section.UNRESOLVED_MESSAGE)
	})
})
