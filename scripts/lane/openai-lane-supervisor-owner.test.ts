import { randomUUID } from 'node:crypto'
import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, expect, it, vi } from 'vitest'
import { openai_lane_supervisor_owner as owner } from './openai-lane-supervisor-owner'

const directory = `/nonexistent/claim-${randomUUID()}`
const nonce = randomUUID()
const DELAY_MS = 3000
const DEAD_PID = 90_001

afterEach(() => {
	owner.release(directory, nonce)
	vi.useRealTimers()
	vi.restoreAllMocks()
})

it('accepts a cold-start claim beyond the former two-second window', async () => {
	vi.useFakeTimers()
	const pending = owner.wait_for_active(directory)

	await vi.advanceTimersByTimeAsync(DELAY_MS)
	owner.claim('6263', directory, nonce)
	await vi.advanceTimersByTimeAsync(DELAY_MS)

	expect(await pending).toMatchObject({ issue: '6263', nonce })
})

it('stops waiting immediately when the launched supervisor has exited', async () => {
	vi.useFakeTimers()
	vi.spyOn(process_identity, 'is_present_pid').mockReturnValue(false)

	expect(await owner.wait_for_active(directory, DEAD_PID)).toBeUndefined()
	expect(vi.getTimerCount()).toBe(0)
})
