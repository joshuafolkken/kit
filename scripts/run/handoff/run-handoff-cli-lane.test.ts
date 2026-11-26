import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_cli } from './run-handoff-cli'
import { run_handoff_cli_fixture } from './run-handoff-cli-fixture'

// joshuafolkken/kit#8994: `run:handoff` starts a numbered run that edits in its lane, not the root checkout.

const make_directory = temporary_directory('suite')
const BRIEF_FILE = path.join(make_directory('josh-run-handoff-lane-'), 'brief.md')
const LANE = '/home/dev/.kit-lanes/12'
const BRIEF_FLAG = '--brief-file'
const { fake } = run_handoff_cli_fixture

writeFileSync(BRIEF_FILE, 'Agreed brief')

beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_cli.run — the work tree', () => {
	it('starts halfrun #12 in its lane and names the lane as the work tree to return to', async () => {
		const held_at: Array<string> = []
		const { ports, requests, directories, lines } = fake({
			lane_directory: async (issue) => (issue === '12' ? LANE : undefined),
			tree_hold: async (directory) => {
				held_at.push(directory)

				return { kind: 'free' }
			},
		})

		await expect(
			run_handoff_cli.run(['halfrun', '12', BRIEF_FLAG, BRIEF_FILE], ports),
		).resolves.toBe(0)
		expect(requests.map((request) => request.cwd)).toStrictEqual([LANE])
		expect(directories.every((directory) => directory.startsWith(LANE))).toBe(true)
		expect(held_at).toStrictEqual([LANE])
		expect(lines).toContain(`work tree: ${LANE}`)
	})

	it('starts fullrun new in the checkout it was typed in, with no lane opened', async () => {
		const lane_directory = vi.fn(async () => LANE)
		const { ports, requests } = fake({ lane_directory })

		await run_handoff_cli.run(['fullrun', 'new', 'Add a flag', BRIEF_FLAG, BRIEF_FILE], ports)

		expect(requests.map((request) => request.cwd)).toStrictEqual(['/repo'])
		expect(lane_directory).not.toHaveBeenCalled()
	})

	it('refuses without starting a child when every lane seat is taken', async () => {
		const { ports, requests, lines } = fake({ lane_directory: async () => undefined })

		await expect(run_handoff_cli.run(['prrun', '12', BRIEF_FLAG, BRIEF_FILE], ports)).resolves.toBe(
			1,
		)
		expect(requests).toStrictEqual([])
		expect(lines.join('\n')).toContain('lane:close')
	})
})
