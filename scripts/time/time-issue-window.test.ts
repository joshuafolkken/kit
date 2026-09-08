import { describe, expect, it } from 'vitest'
import { time_github } from './time-github'
import { time_issue_window } from './time-issue-window'
import { time_windows, type TimeWindow } from './time-windows'

// joshuafolkken/kit#1409: the outermost of the three windows is the only one neither the transcript
// nor the pull-request listing carries, so it is read on its own — and an issue still open answers
// "not measured" rather than a window that never closed.

const OPENED_AT = '2026-09-08T06:46:50Z'
const CLOSED_AT = '2026-09-08T07:11:24Z'
const OPEN_MINUTES = 24.5666
const ISSUE = 1409
const MINUTE_MS = 60_000

// The wire format is written out rather than assembled with `JSON.stringify`: an open issue carries a
// literal `null`, and an `undefined` field would drop the key instead of sending it.
function body(closed_at: string): string {
	return `{"created_at":"${OPENED_AT}","closed_at":${closed_at}}`
}

const CLOSED_BODY = body(`"${CLOSED_AT}"`)
const OPEN_BODY = body('null')

async function read_with(text: string): Promise<TimeWindow> {
	return await time_issue_window.read_issue_window(ISSUE, async () => text)
}

describe('time_issue_window.to_window', () => {
	it('reads a closed issue as a window', () => {
		const window = time_issue_window.to_window(CLOSED_BODY)

		expect(window.is_read).toBe(true)
		expect(window.started_at).toBe(new Date(OPENED_AT).toISOString())
		expect(window.ended_at).toBe(new Date(CLOSED_AT).toISOString())
		expect(window.elapsed_ms / MINUTE_MS).toBeCloseTo(OPEN_MINUTES, 1)
	})

	it('withholds the window of an issue that is still open', () => {
		expect(time_issue_window.to_window(OPEN_BODY)).toEqual(time_windows.UNREAD_WINDOW)
	})

	it('withholds the window when the payload cannot be parsed', () => {
		expect(time_issue_window.to_window('not json').is_read).toBe(false)
	})
})

describe('time_issue_window.read_issue_window', () => {
	it('reads the issue endpoint through the shared reader', async () => {
		const paths: Array<string> = []

		await time_issue_window.read_issue_window(ISSUE, async (path) => {
			paths.push(path)

			return CLOSED_BODY
		})

		expect(paths).toEqual([`${time_github.ISSUES_PATH}/${String(ISSUE)}`])
	})

	it('carries a closed issue through', async () => {
		const window = await read_with(CLOSED_BODY)

		expect(window.is_read).toBe(true)
	})

	it('withholds the window when the read is refused', async () => {
		const window = await time_issue_window.read_issue_window(ISSUE, () => {
			throw new Error('gh: rate limited')
		})

		expect(window).toEqual(time_windows.UNREAD_WINDOW)
	})
})
