import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scoped_green, type ScopedSources } from './scoped-green'

// joshuafolkken/kit#7593: a lane's own bare test:related runs the touched scope, so a lane closes the
// refusal with check:related rather than a test:related that records no full-reach green.

const DIRECTORY = path.join(tmpdir(), `josh-scoped-green-lane-${String(process.pid)}`)

function sources(is_lane: boolean): ScopedSources {
	return {
		lint: path.join(DIRECTORY, 'l.json'),
		test: path.join(DIRECTORY, 't.json'),
		is_unit_skipped: false,
		is_lane,
	}
}

describe('refusal_for in a lane', () => {
	it('closes a lane refusal with check:related', () => {
		expect(scoped_green.refusal_for({ 'a.ts': 'd' }, 'base', sources(true))).toContain(
			'`pnpm josh check:related`, which runs both at full reach',
		)
	})

	it('closes a refusal outside a lane with the lint and test pair', () => {
		expect(scoped_green.refusal_for({ 'a.ts': 'd' }, 'base', sources(false))).toContain(
			`${scoped_green.LINT_COMMAND} && ${scoped_green.TEST_COMMAND}`,
		)
	})
})
