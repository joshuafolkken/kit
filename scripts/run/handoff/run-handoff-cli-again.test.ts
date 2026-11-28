import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_cli, type HandoffPorts } from './run-handoff-cli'
import { run_handoff_cli_fixture } from './run-handoff-cli-fixture'

// joshuafolkken/kit#9166: a brief already handed off is refused unless `--again` says the repeat is
// meant, and `brief-path` gives each session its own brief path.

const make_directory = temporary_directory('suite')
const TEMPORARY = make_directory('josh-run-handoff-again-')
const BRIEF_FILE = path.join(TEMPORARY, 'brief.md')
const OTHER_BRIEF_FILE = path.join(TEMPORARY, 'other.md')
const BRIEF_FLAG = '--brief-file'
const FULLRUN = ['fullrun', '#12', BRIEF_FLAG, BRIEF_FILE]
const { fake, BRIEF_PATH } = run_handoff_cli_fixture

writeFileSync(BRIEF_FILE, 'Agreed brief')
writeFileSync(OTHER_BRIEF_FILE, 'Another brief')

// Ledger ports over one in-memory ledger, shared by every run a test makes.
function ledger(): Pick<HandoffPorts, 'read_ledger' | 'append_ledger'> {
	const rows = new Map<string, string>()

	return {
		read_ledger: (target) => rows.get(target),
		append_ledger: (target, text) => {
			rows.set(target, `${rows.get(target) ?? ''}${text}`)
		},
	}
}

beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_cli.run handed-off ledger', () => {
	it('refuses the same brief handed off twice, naming the first time and its log', async () => {
		const shared = ledger()
		const first = fake(shared)

		expect(await run_handoff_cli.run(FULLRUN, first.ports)).toBe(0)

		const second = fake(shared)

		expect(await run_handoff_cli.run(FULLRUN, second.ports)).toBe(1)
		expect(second.requests).toEqual([])
		expect(second.lines.at(-1)).toMatch(/already handed off at 1970-01-01T00:00:00\.001Z/u)
		expect(second.lines.at(-1)).toContain(first.requests[0]?.log_path)
	})

	it('hands the same brief off again with --again', async () => {
		const shared = ledger()

		await run_handoff_cli.run(FULLRUN, fake(shared).ports)

		const again = fake(shared)

		expect(await run_handoff_cli.run([...FULLRUN, '--again'], again.ports)).toBe(0)
		expect(again.requests).toHaveLength(1)
	})

	it('hands a different brief off after another was recorded', async () => {
		const shared = ledger()

		await run_handoff_cli.run(FULLRUN, fake(shared).ports)

		const other = fake(shared)
		const argv = ['fullrun', '#12', BRIEF_FLAG, OTHER_BRIEF_FILE]

		expect(await run_handoff_cli.run(argv, other.ports)).toBe(0)
	})
})

describe('run_handoff_cli.run ledger row timing', () => {
	it('records a waited kickoff once its child has started', async () => {
		const shared = ledger()
		const kickoff = ['kickoff', 'new', BRIEF_FLAG, BRIEF_FILE]

		await run_handoff_cli.run(kickoff, fake(shared).ports)

		expect(await run_handoff_cli.run(kickoff, fake(shared).ports)).toBe(1)
	})

	it('leaves no ledger row when the child could not start', async () => {
		const shared = ledger()
		const failed = fake({ ...shared, launch: () => ({ kind: 'failed', note: 'spawn' }) })

		expect(await run_handoff_cli.run(FULLRUN, failed.ports)).toBe(1)
		expect(await run_handoff_cli.run(FULLRUN, fake(shared).ports)).toBe(0)
	})
})

describe('run_handoff_cli.run brief-path', () => {
	it('prints the fresh brief path the port gives', async () => {
		const { ports, lines, requests } = fake()

		expect(await run_handoff_cli.run(['brief-path'], ports)).toBe(0)
		expect([lines, requests]).toEqual([[BRIEF_PATH], []])
	})
})
