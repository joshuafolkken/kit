import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_cli } from './run-handoff-cli'
import { run_handoff_cli_fixture } from './run-handoff-cli-fixture'

// joshuafolkken/kit#9148: `run:handoff --wip <name>` puts the adopt row where the line's Issue gets it.

const make_directory = temporary_directory('suite')
const BRIEF_FILE = path.join(make_directory('josh-run-handoff-wip-'), 'brief.md')
const BRIEF_FLAG = '--brief-file'
const WIP_FLAG = '--wip'
const SHA = 'abc1234def'
const { fake } = run_handoff_cli_fixture

writeFileSync(BRIEF_FILE, 'Agreed brief')

beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_cli.run --wip', () => {
	it('hands a new child the resolved row for its filing to write', async () => {
		const { ports, requests } = fake({ resolve_commit: async () => SHA })
		const argv = ['fullrun', 'new', BRIEF_FLAG, BRIEF_FILE, WIP_FLAG, 'x']

		expect(await run_handoff_cli.run(argv, ports)).toBe(0)
		expect(requests[0]?.env).toMatchObject({ JOSH_HANDOFF_WIP: `wip/x@${SHA}` })
	})

	it('writes the row into the named Issue before the child starts', async () => {
		const write_adopt_row = vi.fn(async () => undefined)
		const { ports, requests } = fake({ resolve_commit: async () => SHA, write_adopt_row })
		const argv = ['fullrun', '12', BRIEF_FLAG, BRIEF_FILE, WIP_FLAG, 'x']

		expect(await run_handoff_cli.run(argv, ports)).toBe(0)
		expect(write_adopt_row).toHaveBeenCalledWith('12', { branch: 'wip/x', sha: SHA })
		expect(requests[0]?.env).not.toHaveProperty('JOSH_HANDOFF_WIP')
	})

	it('starts no child when the named Issue cannot take the row', async () => {
		const { ports, requests, lines } = fake({
			resolve_commit: async () => SHA,
			write_adopt_row: async () => 'the body names another row',
		})
		const argv = ['fullrun', '12', BRIEF_FLAG, BRIEF_FILE, WIP_FLAG, 'x']

		expect(await run_handoff_cli.run(argv, ports)).toBe(1)
		expect(requests).toHaveLength(0)
		expect(lines.join('\n')).toContain('--wip: the body names another row')
	})

	it('names --wip in the usage it prints with a refusal', async () => {
		const { ports, lines } = fake()

		expect(await run_handoff_cli.run(['fullrun', 'new', WIP_FLAG], ports)).toBe(1)
		expect(lines.join('\n')).toContain('[--wip <name>]')
	})
})
