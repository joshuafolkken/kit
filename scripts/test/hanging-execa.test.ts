import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hanging_execa } from './hanging-execa'

const BINARY = 'git'
const ARGUMENTS = ['rev-parse', 'HEAD']
const BUDGET_MS = 500
const ANSWER = 'abc123'
const PENDING = 'pending'

// A promise that is still open once every timer has run loses the race to the marker.
async function settle_or_pending(pending: Promise<unknown>): Promise<unknown> {
	return await Promise.race([pending, Promise.resolve(PENDING)])
}

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('hanging_execa.spawn with a timeout', () => {
	it('rejects the way execa ends a spawn it killed on its budget', async () => {
		const pending = hanging_execa.spawn(BINARY, ARGUMENTS, { timeout: BUDGET_MS })
		// The handler is attached before the advance: the timer that rejects fires inside it.
		const assertion = expect(pending).rejects.toMatchObject({
			message: 'Command timed out after 500 milliseconds: git',
			timedOut: true,
		})

		await vi.advanceTimersByTimeAsync(BUDGET_MS)

		await assertion
	})

	it('resolves a timed-out result when the caller passed reject: false', async () => {
		const pending = hanging_execa.spawn(BINARY, ARGUMENTS, { timeout: BUDGET_MS, reject: false })

		await vi.advanceTimersByTimeAsync(BUDGET_MS)

		await expect(pending).resolves.toStrictEqual({ stdout: '', timedOut: true })
	})

	it('stays open until the budget is spent', async () => {
		const pending = hanging_execa.spawn(BINARY, ARGUMENTS, { timeout: BUDGET_MS, reject: false })

		await vi.advanceTimersByTimeAsync(BUDGET_MS - 1)

		expect(await settle_or_pending(pending)).toBe(PENDING)
	})
})

describe('hanging_execa.spawn without a timeout', () => {
	it('never settles', async () => {
		const pending = hanging_execa.spawn(BINARY, ARGUMENTS)

		await vi.runAllTimersAsync()

		expect(await settle_or_pending(pending)).toBe(PENDING)
	})
})

describe('hanging_execa.answer_with', () => {
	it('answers the named binary at once and leaves the others hanging', async () => {
		hanging_execa.answer_with(BINARY, ANSWER)

		const other = hanging_execa.spawn('sysctl')

		await expect(hanging_execa.spawn(BINARY, ARGUMENTS)).resolves.toStrictEqual({
			stdout: ANSWER,
			timedOut: false,
		})
		expect(await settle_or_pending(other)).toBe(PENDING)
	})
})

describe('hanging_execa call record', () => {
	it('records each spawn and the budget it carried, in call order', () => {
		hanging_execa.answer_with(BINARY, ANSWER)
		void hanging_execa.spawn(BINARY, ARGUMENTS, { timeout: BUDGET_MS })
		void hanging_execa.spawn(BINARY)

		expect(hanging_execa.timeouts()).toStrictEqual([BUDGET_MS, undefined])
		expect(hanging_execa.calls()[0]).toStrictEqual({
			file: BINARY,
			arguments_list: ARGUMENTS,
			options: { timeout: BUDGET_MS },
		})
	})

	it('forgets the answers and the calls on reset', async () => {
		hanging_execa.answer_with(BINARY, ANSWER)
		void hanging_execa.spawn(BINARY)

		hanging_execa.reset()

		expect(hanging_execa.calls()).toStrictEqual([])
		expect(await settle_or_pending(hanging_execa.spawn(BINARY))).toBe(PENDING)
	})
})
