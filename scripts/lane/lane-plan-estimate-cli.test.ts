import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'

const directory = temporary_directory()
const SOURCE = 'scripts/a.ts'
const DOC = 'docs/a.md'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane:plan estimate integration', () => {
	it('advertises the estimate input in the command usage', () => {
		expect(lane_plan_cli.USAGE).toContain('[--estimate <json-file>]')
	})

	it('passes the expanded scope and size to the existing check, preserving the single contract decision', async () => {
		const file = path.join(directory('scope-cli-'), 'scope.json')
		const changes = [
			{ path: SOURCE, changed_lines: 20 },
			{ path: DOC, changed_lines: 6 },
		]

		writeFileSync(file, JSON.stringify({ changes }))
		const check = vi.spyOn(lane_plan_check, 'check_plan').mockResolvedValue(0)

		await expect(lane_plan_cli.run(['7381', SOURCE, '--estimate', file, '--single'])).resolves.toBe(
			0,
		)
		expect(check).toHaveBeenCalledWith(
			expect.objectContaining({
				paths: [SOURCE, DOC],
				estimated_size: { files: 2, lines: 26 },
				single: true,
			}),
			process.cwd(),
		)
	})
})
