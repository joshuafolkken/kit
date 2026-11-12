import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_lane } from './run-park-lane'

const make_directory = temporary_directory('suite')

const ISSUE = '4132'
const SEAT = 3
const BODY = 'Which option?\n'
const WORK_DIRECTORY = make_directory('run-park-lane-')
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)

beforeEach(() => {
	vi.stubEnv('JOSH_LANE_ROOT', LANE_ROOT)
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	writeFileSync(path.join(LANE_DIRECTORY, '.env'), `JOSH_LANE_SEAT=${String(SEAT)}\n`)
})

afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(LANE_DIRECTORY, { recursive: true, force: true })
})

// joshuafolkken/kit#5840: a park from inside a lane names the lane it keeps.
describe('run_park_lane.with_lane_note', () => {
	it('appends the lane directory, the held seat and the lane:close hint inside a lane', () => {
		const note = run_park_lane.with_lane_note(BODY, LANE_DIRECTORY)

		expect(note.startsWith(BODY)).toBe(true)
		expect(note).toContain(`Lane directory: \`${LANE_DIRECTORY}\``)
		expect(note).toContain(`Seat ${String(SEAT)} stays held`)
		expect(note).toContain(`\`pnpm josh lane:close ${ISSUE}\``)
	})

	it('names the lane from a Claude Code worktree under it', () => {
		const nested = path.join(LANE_DIRECTORY, '.claude', 'worktrees', 'agent')

		expect(run_park_lane.with_lane_note(BODY, nested)).toContain(
			`Lane directory: \`${LANE_DIRECTORY}\``,
		)
	})

	it('reads an unreadable seat as unknown', () => {
		rmSync(path.join(LANE_DIRECTORY, '.env'))

		expect(run_park_lane.with_lane_note(BODY, LANE_DIRECTORY)).toContain('Seat unknown stays held')
	})

	it('leaves the body unchanged outside a lane', () => {
		expect(run_park_lane.with_lane_note(BODY, WORK_DIRECTORY)).toBe(BODY)
	})
})
