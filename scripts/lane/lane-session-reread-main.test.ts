import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4732: the fresh process a broker starts prints the answer, or exits 1 having read
// nothing.

const answer_text = vi.hoisted(() => vi.fn())
const ENTRY = path.join(import.meta.dirname, 'lane-session-reread-main.ts')
const ISSUE = '4732'
const REQUEST = '{"session":"s"}'
const saved = { argv: process.argv, exit_code: process.exitCode }

vi.mock('./lane-session-reread', () => ({ lane_session_reread: { answer_text } }))

beforeEach(() => {
	vi.resetModules()
	answer_text.mockReset()
	process.argv = [process.execPath, ENTRY, ISSUE, REQUEST]
	process.exitCode = undefined
})

afterEach(() => {
	process.argv = saved.argv
	process.exitCode = saved.exit_code
	vi.restoreAllMocks()
})

describe('lane-session-reread-main', () => {
	it('prints the answer to the issue and the request it was given', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		answer_text.mockResolvedValue({ is_success: true })
		await import('./lane-session-reread-main')

		expect(answer_text).toHaveBeenCalledWith(ISSUE, REQUEST)
		expect(write).toHaveBeenCalledWith('{"is_success":true}\n')
		expect(process.exitCode).toBeUndefined()
	})

	it('exits 1 and prints nothing where it read nothing', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		answer_text.mockResolvedValue(undefined)
		await import('./lane-session-reread-main')

		expect(write).not.toHaveBeenCalled()
		expect(process.exitCode).toBe(1)
	})
})
