import path from 'node:path'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hook } from './format-edited-file'
import { unplanned_edit } from './unplanned-edit'

// joshuafolkken/kit#7640: the edit hook's one envelope carries the unplanned file's `lane:plan` answer.

const make_directory = temporary_directory('suite')
const FILE = path.join(make_directory('format-edited-unplanned-'), 'absent.unformatted')
const YIELD_TEXT = '`lane:plan` would yield to #7620'

function written(): Array<string> {
	return vi.mocked(process.stdout.write).mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(time_density_hook, 'density_notice').mockReturnValue(undefined)
})

function payload(): string {
	return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: FILE } })
}

describe('run_hook — an unplanned file', () => {
	it("writes the lane:plan answer into the hook's additional context", async () => {
		vi.spyOn(unplanned_edit, 'notice').mockResolvedValue(YIELD_TEXT)

		await run_hook(payload())

		expect(unplanned_edit.notice).toHaveBeenCalledWith(FILE, process.cwd(), process.env)
		expect(written().join('')).toContain(YIELD_TEXT)
	})

	it('writes nothing when the file is planned', async () => {
		vi.spyOn(unplanned_edit, 'notice').mockResolvedValue(undefined)

		await run_hook(payload())

		expect(written()).toEqual([])
	})
})
