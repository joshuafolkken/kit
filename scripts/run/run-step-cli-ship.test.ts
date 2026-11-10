import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_prep } from './run-prep'
import { run_step_cli } from './run-step-cli'

// joshuafolkken/kit#7111: `run:entry` printed the same ship preconditions, so `run:step` prints an
// unchanged list once per session and a single line after that.

const SESSION_KEY = 'CLAUDE_CODE_SESSION_ID'
const ISSUE = '7111'
const FIRST_PROBLEM = 'criterion one pending'
const SECOND_PROBLEM = 'criterion two pending'

beforeEach(() => {
	vi.stubEnv(SESSION_KEY, randomUUID())
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_step_cli.ship_text — the ship preconditions once per session', () => {
	it('prints the list in full the first time', () => {
		expect(run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM])).toBe(run_prep.ship_body([FIRST_PROBLEM]))
	})

	it('prints one line naming run:prep for an unchanged list', () => {
		run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM])
		const repeated = run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM])

		expect(repeated).toContain('printed earlier this session')
		expect(repeated).toContain(`pnpm josh run:prep ${ISSUE}`)
		expect(repeated).not.toContain(FIRST_PROBLEM)
	})

	it('prints a changed list again in full', () => {
		run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM])
		const changed = run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM, SECOND_PROBLEM])

		expect(changed).toBe(run_prep.ship_body([FIRST_PROBLEM, SECOND_PROBLEM]))
	})

	it('prints the list in full every time without a session id', () => {
		vi.stubEnv(SESSION_KEY, undefined)
		run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM])

		expect(run_step_cli.ship_text(ISSUE, [FIRST_PROBLEM])).toContain(FIRST_PROBLEM)
	})
})
