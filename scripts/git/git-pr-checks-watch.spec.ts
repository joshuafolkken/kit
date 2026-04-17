import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
	create_watch_settle_guard,
	handle_watch_close,
	handle_watch_timeout,
	type WatchResult,
} from './git-pr-checks-watch'

function make_child_with_kill_spy(): { child: ChildProcess; kill_spy: ReturnType<typeof vi.fn> } {
	const kill_spy = vi.fn()

	return { child: { kill: kill_spy } as unknown as ChildProcess, kill_spy }
}

describe('create_watch_settle_guard', () => {
	it('starts unsettled', () => {
		const guard = create_watch_settle_guard()

		expect(guard.is_settled()).toBe(false)
	})

	it('becomes settled after settle() is called', () => {
		const guard = create_watch_settle_guard()

		guard.settle()

		expect(guard.is_settled()).toBe(true)
	})
})

describe('handle_watch_timeout', () => {
	it('resolves with timed_out: true and settles the guard when guard is unsettled', () => {
		const guard = create_watch_settle_guard()
		const { child, kill_spy } = make_child_with_kill_spy()
		const resolve = vi.fn<(result: WatchResult) => void>()

		handle_watch_timeout(guard, child, resolve)

		expect(resolve).toHaveBeenCalledWith({ timed_out: true })
		expect(guard.is_settled()).toBe(true)
		expect(kill_spy).toHaveBeenCalled()
	})

	it('does nothing when guard is already settled', () => {
		const guard = create_watch_settle_guard()

		guard.settle()

		const { child, kill_spy } = make_child_with_kill_spy()
		const resolve = vi.fn<(result: WatchResult) => void>()

		handle_watch_timeout(guard, child, resolve)

		expect(resolve).not.toHaveBeenCalled()
		expect(kill_spy).not.toHaveBeenCalled()
	})
})

describe('handle_watch_close', () => {
	it('resolves with timed_out: false when code is 0 and guard is unsettled', () => {
		const guard = create_watch_settle_guard()
		const timeout_id = setTimeout(vi.fn(), 10_000)
		const resolve = vi.fn<(result: WatchResult) => void>()
		const reject = vi.fn<(error: Error) => void>()

		handle_watch_close({ guard, timeout_id, code: 0, callbacks: { resolve, reject } })

		expect(resolve).toHaveBeenCalledWith({ timed_out: false })
		expect(reject).not.toHaveBeenCalled()
	})

	it('rejects with an error when code is non-zero', () => {
		const guard = create_watch_settle_guard()
		const timeout_id = setTimeout(vi.fn(), 10_000)
		const resolve = vi.fn<(result: WatchResult) => void>()
		const reject = vi.fn<(error: Error) => void>()

		handle_watch_close({ guard, timeout_id, code: 1, callbacks: { resolve, reject } })

		expect(reject).toHaveBeenCalledWith(expect.any(Error))
		expect(resolve).not.toHaveBeenCalled()
	})

	it('is a no-op when guard is already settled', () => {
		const guard = create_watch_settle_guard()

		guard.settle()

		const timeout_id = setTimeout(vi.fn(), 10_000)
		const resolve = vi.fn<(result: WatchResult) => void>()
		const reject = vi.fn<(error: Error) => void>()

		handle_watch_close({ guard, timeout_id, code: 0, callbacks: { resolve, reject } })

		expect(resolve).not.toHaveBeenCalled()
		clearTimeout(timeout_id)
	})
})
