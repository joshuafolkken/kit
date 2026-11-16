import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_seat_lock } from './lane-seat-lock'

const make_directory = temporary_directory('suite')

const ROOT = make_directory('lane-seat-lock-')
const LOCK = path.join(ROOT, '.seat-locks', 'seat-1')
const OTHER_PID = '4242'
const LONG_AGO = new Date('2026-01-01T00:00:00Z')

function owner(): string {
	return readFileSync(path.join(LOCK, lane_seat_lock.OWNER_FILE), 'utf8')
}

function held_by(pid: string | undefined): void {
	mkdirSync(LOCK, { recursive: true })
	if (pid !== undefined) writeFileSync(path.join(LOCK, lane_seat_lock.OWNER_FILE), pid)
}

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(ROOT, { force: true, recursive: true })
})

describe('seat lock claim', () => {
	it('records the claiming process as the owner', () => {
		expect(lane_seat_lock.claim(LOCK)).toBe(true)
		expect(owner()).toBe(String(process.pid))
	})

	it('reclaims a lock whose owner is gone', () => {
		held_by(OTHER_PID)
		vi.spyOn(process_identity, 'is_present_pid').mockReturnValue(false)

		expect(lane_seat_lock.claim(LOCK)).toBe(true)
		expect(owner()).toBe(String(process.pid))
		expect(existsSync(`${LOCK}.abandoned-${String(process.pid)}`)).toBe(false)
	})

	it('leaves a lock whose owner is still running', () => {
		held_by(OTHER_PID)
		vi.spyOn(process_identity, 'is_present_pid').mockReturnValue(true)

		expect(lane_seat_lock.claim(LOCK)).toBe(false)
		expect(owner()).toBe(OTHER_PID)
	})

	it('leaves a lock whose owner is not yet written', () => {
		held_by(undefined)
		const presence = vi.spyOn(process_identity, 'is_present_pid')

		expect(lane_seat_lock.claim(LOCK)).toBe(false)
		expect(presence).not.toHaveBeenCalled()
	})

	it('reclaims a lock left ownerless past the grace', () => {
		held_by(undefined)
		utimesSync(LOCK, LONG_AGO, LONG_AGO)

		expect(lane_seat_lock.is_abandoned(LOCK)).toBe(true)
		expect(lane_seat_lock.claim(LOCK)).toBe(true)
		expect(owner()).toBe(String(process.pid))
	})
})

describe('seat lock release', () => {
	it('releases the lock with its owner', () => {
		lane_seat_lock.claim(LOCK)
		lane_seat_lock.release(LOCK)

		expect(existsSync(LOCK)).toBe(false)
	})
})
