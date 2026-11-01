import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { live_evidence } from '#scripts/review/live-evidence'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const existing_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const tree_mock = vi.hoisted(() => vi.fn<() => Promise<GateTree>>())
// Read by the `tree-verdict` mock's factory, which runs at the module's `import` below, after this.
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-evidence-'))

vi.mock('./run-ship-body-draft', () => ({ run_ship_body_draft: { existing: existing_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: tree_mock } }))
vi.mock(import('#scripts/gate/tree-verdict'), async (import_original) => {
	const { tree_verdict } = await import_original()

	// A record lands in this test's directory, never the shared temp root.
	return {
		tree_verdict: {
			...tree_verdict,
			record_path: (name: string): string => path.join(TEMPORARY, `${name}.json`),
		},
	}
})

const { run_ship_evidence_cli } = await import('./run-ship-evidence-cli')

// joshuafolkken/kit#5585: `josh ship:evidence` runs the command it is given and records it in the draft.
const DRAFT = path.join(TEMPORARY, 'josh-ship-body-5585.md')
const RUNTIME_PATH = 'scripts/run/ship/run-ship-evidence-cli.ts'
const FAILURE_EXIT_CODE = 1
const PRINT_42 = ['5585', '--', 'node', '-e', 'console.log(42)']

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	writeFileSync(DRAFT, `${live_evidence.EVIDENCE_HEADING}\n`)
	existing_mock.mockResolvedValue(DRAFT)
	// A tree git could not read keys nothing, so the cases outside the reuse block run every time.
	tree_mock.mockResolvedValue({ files: {}, base: undefined })
})

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

function draft_text(): string {
	return readFileSync(DRAFT, 'utf8')
}

describe('run_ship_evidence_cli.run', () => {
	it('runs the command and appends it with its output to the draft', async () => {
		await expect(run_ship_evidence_cli.run(PRINT_42)).resolves.toBe(0)

		expect(draft_text()).toContain("`node -e 'console.log(42)'`\n\n```\n42\n```\n")
		expect(live_evidence.verdict_for([RUNTIME_PATH], draft_text())).toBe('satisfied')
	})

	// joshuafolkken/kit#5617: a parent FORCE_COLOR made Node warn that NO_COLOR is ignored.
	it('keeps an inherited FORCE_COLOR out of the recorded command’s output', async () => {
		vi.stubEnv('FORCE_COLOR', '1')

		await expect(run_ship_evidence_cli.run(PRINT_42)).resolves.toBe(0)

		expect(draft_text()).not.toContain('NO_COLOR')
		expect(draft_text()).toContain('```\n42\n```\n')
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

// joshuafolkken/kit#5693: a command already run on this tree with these arguments is not run again.
const MARKER = path.join(TEMPORARY, 'runs')
const RECORD_PREFIX = 'ship-evidence-'
const SOURCE = 'src/a.ts'
const TREE: GateTree = { files: { [SOURCE]: 'digest-a' }, base: 'base-a' }

// A command that leaves one byte in `MARKER` per start, so a reuse is seen as no new byte.
function counting(code: number, label = 'once', flags: ReadonlyArray<string> = []): Array<string> {
	const script = `require('fs').appendFileSync(${JSON.stringify(MARKER)}, 'x'); console.log('ran ${label}'); process.exit(${String(code)})`

	return ['5585', ...flags, '--', 'node', '-e', script]
}

function runs(): number {
	return readFileSync(MARKER, 'utf8').length
}

function on_unrecorded_tree(): void {
	for (const name of readdirSync(TEMPORARY)) {
		if (name.startsWith(RECORD_PREFIX)) rmSync(path.join(TEMPORARY, name))
	}

	writeFileSync(MARKER, '')
	tree_mock.mockResolvedValue(TREE)
}

describe('run_ship_evidence_cli.run — a recorded run on the same tree', () => {
	beforeEach(on_unrecorded_tree)

	it('writes the recorded output without starting the command again', async () => {
		await run_ship_evidence_cli.run(counting(0))
		writeFileSync(DRAFT, `${live_evidence.EVIDENCE_HEADING}\n`)

		await expect(run_ship_evidence_cli.run(counting(0))).resolves.toBe(0)

		expect(runs()).toBe(1)
		expect(draft_text()).toMatch(
			/^reused: tree \w+ green at .+\n\n`node -e .+\n\n```\nran once\n```\n/mu,
		)
	})

	it('runs the command again under --fresh', async () => {
		await run_ship_evidence_cli.run(counting(0))

		await run_ship_evidence_cli.run(counting(0, 'once', ['--fresh']))

		expect(runs()).toBe(2)
		expect(draft_text()).not.toContain('reused:')
	})

	it('returns a recorded failure’s exit code on reuse', async () => {
		await expect(run_ship_evidence_cli.run(counting(3))).resolves.toBe(3)

		await expect(run_ship_evidence_cli.run(counting(3))).resolves.toBe(3)

		expect(runs()).toBe(1)
	})
})

describe('run_ship_evidence_cli.run — a changed tree or command', () => {
	beforeEach(on_unrecorded_tree)

	it('runs again when one file’s content changes', async () => {
		await run_ship_evidence_cli.run(counting(0))
		tree_mock.mockResolvedValue({ ...TREE, files: { [SOURCE]: 'digest-b' } })

		await run_ship_evidence_cli.run(counting(0))

		expect(runs()).toBe(2)
	})

	it('runs again when the arguments differ', async () => {
		await run_ship_evidence_cli.run(counting(0))

		await run_ship_evidence_cli.run(counting(0, 'twice'))

		expect(runs()).toBe(2)
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
