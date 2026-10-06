import { lane_park } from '#scripts/rules/lane-park'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_entry_stop, type StopNotice, type StopPorts } from './run-entry-stop'

const ISSUE = '3099'
const info_lines: Array<string> = []

function notice(should_release: boolean): StopNotice {
	return {
		issue_number: ISSUE,
		command: 'fullrun',
		reason: run_entry_stop.BUDGET_REASON,
		should_release,
	}
}

interface PortState {
	is_sent: boolean
	is_released?: boolean
	is_child?: boolean
}

function ports({
	is_sent,
	is_released = true,
	is_child = false,
}: PortState): StopPorts & { order: Array<string> } {
	const order: Array<string> = []

	return {
		order,
		notify: vi.fn(async () => {
			order.push('notify')

			return is_sent
		}),
		release: vi.fn(async () => {
			order.push('release')

			return is_released
		}),
		is_parking_child: function is_parking_child(): boolean {
			return is_child
		},
	}
}

beforeEach(() => {
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
})

describe('run_entry_stop.stop — the stop carries its own chores', () => {
	it('releases the claim before notifying, then prints the notify marker', async () => {
		const stop_ports = ports({ is_sent: true })

		await run_entry_stop.stop(notice(true), stop_ports)

		expect(stop_ports.order).toStrictEqual(['release', 'notify'])
		expect(stop_ports.release).toHaveBeenCalledWith(ISSUE)
		expect(info_lines).toStrictEqual([
			run_entry_stop.RELEASED_NOTE,
			lane_park.COMMAND_NOTIFY_MARKER,
		])
	})

	it('notifies without releasing a hold this call did not claim', async () => {
		const stop_ports = ports({ is_sent: true })
		const body = run_entry_stop.body_of(notice(false))

		await run_entry_stop.stop(notice(false), stop_ports)

		expect(stop_ports.release).not.toHaveBeenCalled()
		expect(stop_ports.notify).toHaveBeenCalledWith(expect.objectContaining({ body }))
		expect(info_lines).toStrictEqual([lane_park.COMMAND_NOTIFY_MARKER])
	})

	// A failed send must leave the `Stop` hook still asking for the notify, so the marker is withheld.
	it('prints the failure note instead of the marker when the Telegram does not go out', async () => {
		await run_entry_stop.stop(notice(false), ports({ is_sent: false }))

		expect(info_lines).toStrictEqual([run_entry_stop.NOTIFY_FAILED_NOTE])
	})
})

describe('run_entry_stop.stop — what it withholds', () => {
	// A failed release must leave the agent still asked to release, so the released note is withheld.
	it('prints the release failure note when the release does not succeed', async () => {
		await run_entry_stop.stop(notice(true), ports({ is_sent: true, is_released: false }))

		expect(info_lines).toStrictEqual([
			run_entry_stop.RELEASE_FAILED_NOTE,
			lane_park.COMMAND_NOTIFY_MARKER,
		])
	})

	// A lane child's stop parks before it notifies; a Telegram from here would bypass the park guard.
	it('sends no Telegram and prints no marker from a dispatched lane child', async () => {
		const stop_ports = ports({ is_sent: true, is_child: true })

		await run_entry_stop.stop(notice(false), stop_ports)

		expect(stop_ports.notify).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([])
	})
})

describe('run_entry_stop.body_of — the resume the Telegram names', () => {
	it('names the command, the reason and the resume', () => {
		const stopped = `fullrun #${ISSUE} stopped at entry: ${run_entry_stop.BUDGET_REASON}.`

		expect(run_entry_stop.body_of(notice(false))).toBe(
			`${stopped}\nResume with \`fullrun #${ISSUE}\`.`,
		)
	})
})
