import { ts_entry_loader } from '#scripts/run/ts-entry-loader'
import { describe, expect, it } from 'vitest'
import { openai_lane_supervisor } from './openai-lane-supervisor'

const ISSUE = '7013'
const NONCE = 'nonce'

// joshuafolkken/kit#7013: the dispatcher runs in-process under plain node, so its `execArgv` carries
// no TypeScript loader for the detached `.ts` supervisor entry.
describe('openai_lane_supervisor.supervisor_argv', () => {
	it('starts the supervisor entry with a TypeScript loader', () => {
		const { command, args } = openai_lane_supervisor.supervisor_argv(ISSUE, NONCE)

		expect(command).toBe(process.execPath)
		expect(args).toEqual(
			expect.arrayContaining([ts_entry_loader.IMPORT_FLAG, ts_entry_loader.loader_url()]),
		)
		expect(args.slice(-3)).toStrictEqual([
			expect.stringMatching(/openai-lane-supervisor-entry\.ts$/u),
			ISSUE,
			NONCE,
		])
	})
})
