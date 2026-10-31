import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { live_evidence } from '#scripts/review/live-evidence'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const existing_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())

vi.mock('./run-ship-body-draft', () => ({ run_ship_body_draft: { existing: existing_mock } }))

const { run_ship_evidence_cli } = await import('./run-ship-evidence-cli')

// joshuafolkken/kit#5585: `josh ship:evidence` runs the command it is given and records it in the draft.

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-evidence-'))
const DRAFT = path.join(TEMPORARY, 'josh-ship-body-5585.md')
const RUNTIME_PATH = 'scripts/run/ship/run-ship-evidence-cli.ts'
const FAILURE_EXIT_CODE = 1

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	writeFileSync(DRAFT, `${live_evidence.EVIDENCE_HEADING}\n`)
	existing_mock.mockResolvedValue(DRAFT)
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

function draft_text(): string {
	return readFileSync(DRAFT, 'utf8')
}

describe('run_ship_evidence_cli.run', () => {
	it('runs the command and appends it with its output to the draft', async () => {
		await expect(
			run_ship_evidence_cli.run(['5585', '--', 'node', '-e', 'console.log(42)']),
		).resolves.toBe(0)

		expect(draft_text()).toContain("`node -e 'console.log(42)'`\n\n```\n42\n```\n")
		expect(live_evidence.verdict_for([RUNTIME_PATH], draft_text())).toBe('satisfied')
	})

	it('accepts the command with no separator, and exits with the command’s own code', async () => {
		await expect(
			run_ship_evidence_cli.run(['5585', 'node', '-e', 'process.exit(3)']),
		).resolves.toBe(3)

		expect(draft_text()).toContain("`node -e 'process.exit(3)'`")
	})

	it('ends a command that reads stdin instead of waiting on it', async () => {
		await expect(
			run_ship_evidence_cli.run(['5585', '--', 'node', '-e', 'process.stdin.pipe(process.stdout)']),
		).resolves.toBe(0)
	})

	it('records why a command that never ran failed, rather than an empty output', async () => {
		await expect(
			run_ship_evidence_cli.run(['5585', '--', 'josh-no-such-command-5585']),
		).resolves.toBe(FAILURE_EXIT_CODE)

		expect(draft_text()).toContain('spawn josh-no-such-command-5585 ENOENT\n```\n')
	})
})

describe('run_ship_evidence_cli.run — refusals', () => {
	it.each([[[]], [['5585']], [['5585', '--']], [['abc', '--', 'ls']]])(
		'refuses %j as a usage error',
		async (argv) => {
			await expect(run_ship_evidence_cli.run(argv)).resolves.toBe(FAILURE_EXIT_CODE)

			expect(existing_mock).not.toHaveBeenCalled()
		},
	)

	it('refuses when the issue has no draft, running nothing', async () => {
		existing_mock.mockResolvedValue(undefined)

		await expect(run_ship_evidence_cli.run(['5585', '--', 'ls'])).resolves.toBe(FAILURE_EXIT_CODE)

		expect(draft_text()).toBe(`${live_evidence.EVIDENCE_HEADING}\n`)
	})
})
