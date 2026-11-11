import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget } from './core-budget'
import type { GateStepResult } from './gate-report'
import { gate_run_steps } from './gate-run-steps'
import type { MachineReading } from './machine-capacity'
import { project_gate_steps, type StepBudget } from './project-gate-steps'

// joshuafolkken/kit#7206: a project's gate step claims its cores in the machine-wide budget, so heavy
// steps in two lanes wait for each other instead of filling the machine together.

const CORES = 4
const BLOCKER = `${core_budget.RESERVED_PREFIX}blocker.json`
const UNREAD: MachineReading = { busy_cores: undefined, available_mb: undefined }
const CARGO = { name: 'cargo', command: 'cargo build' }

const probe = { ledger: '', project: '' }
const make_directory = temporary_directory()

beforeEach(() => {
	probe.ledger = make_directory('josh-project-step-budget-ledger-')
	probe.project = make_directory('josh-project-step-budget-root-')
})

afterEach(() => {
	vi.restoreAllMocks()
})

async function no_wait(): Promise<void> {
	await Promise.resolve()
}

function declare_steps(steps: ReadonlyArray<object>): void {
	const manifest = { josh: { gate: { steps } } }

	writeFileSync(path.join(probe.project, 'package.json'), JSON.stringify(manifest))
}

function claims_in_ledger(): ReadonlyArray<string> {
	return readdirSync(probe.ledger).filter((name) => name.startsWith(core_budget.RESERVED_PREFIX))
}

function write_blocker(): void {
	const payload = { ...process_identity.own_fields(), claimed_at: 0, weight: CORES, admitted_at: 0 }

	writeFileSync(path.join(probe.ledger, BLOCKER), JSON.stringify(payload))
}

function budget_of(sleep: () => Promise<void> = no_wait, is_reserved = true): StepBudget {
	const options = { directory: probe.ledger, now: () => 1, sleep, read_machine: async () => UNREAD }

	return { available_cores: CORES, is_reserved, options }
}

async function run_steps(budget: StepBudget = budget_of()): Promise<ReadonlyArray<GateStepResult>> {
	return await project_gate_steps.run_project_steps(probe.project, undefined, budget)
}

// Each step's run reports the claims the ledger held while it ran, then exits with `exit_code`.
function stub_runs(exit_code = 0): Array<ReadonlyArray<string>> {
	const held: Array<ReadonlyArray<string>> = []

	vi.spyOn(gate_run_steps, 'run_gate_step').mockImplementation(async (step) => {
		held.push(claims_in_ledger())

		return await {
			label: step.label,
			command: step.command_args.join(' '),
			output: '',
			exit_code,
			elapsed_ms: 0,
		}
	})

	return held
}

describe('run_project_steps — admission', () => {
	it('runs at once under its claim when the budget has room', async () => {
		declare_steps([CARGO])
		const held = stub_runs()
		const sleep = vi.fn(no_wait)

		const [result] = await run_steps(budget_of(sleep))

		expect(sleep).not.toHaveBeenCalled()
		expect(held.map((claims) => claims.length)).toStrictEqual([1])
		expect(result?.claim).toStrictEqual({ requested: CORES, granted: CORES, waited_ms: 0 })
		expect(claims_in_ledger()).toStrictEqual([])
	})

	it('waits while another claim fills the budget, and runs once it is released', async () => {
		declare_steps([CARGO])
		write_blocker()
		const held = stub_runs()
		const sleep = vi.fn(async () => {
			rmSync(path.join(probe.ledger, BLOCKER), { force: true })
			await no_wait()
		})

		await run_steps(budget_of(sleep))

		expect(sleep).toHaveBeenCalled()
		expect(held.map((claims) => claims.includes(BLOCKER))).toStrictEqual([false])
	})
})

describe('run_project_steps — release', () => {
	it('releases its claim when the step fails', async () => {
		declare_steps([CARGO])
		stub_runs(FAIL_EXIT_CODE)

		const [failed] = await run_steps()

		expect(failed?.exit_code).toBe(FAIL_EXIT_CODE)
		expect(claims_in_ledger()).toStrictEqual([])
	})

	it('releases its claim when the step throws', async () => {
		declare_steps([CARGO])
		const failure = new Error('spawn failed')

		vi.spyOn(gate_run_steps, 'run_gate_step').mockRejectedValue(failure)

		await expect(run_steps()).rejects.toBe(failure)
		expect(claims_in_ledger()).toStrictEqual([])
	})
})

describe('run_project_steps — weight', () => {
	it('claims a step’s declared cores, at most the whole budget', async () => {
		declare_steps([
			{ name: 'light', command: 'cargo fmt --check', cores: 1 },
			{ name: 'wide', command: 'cargo build --release', cores: CORES + 1 },
		])
		stub_runs()

		const results = await run_steps()

		expect(results.map((result) => result.claim?.requested)).toStrictEqual([1, CORES])
	})

	it('claims nothing in a nested gate, whose outer gate holds the cores', async () => {
		declare_steps([CARGO])
		const held = stub_runs()

		const [result] = await run_steps(budget_of(no_wait, false))

		expect(held).toStrictEqual([[]])
		expect(result?.claim).toBeUndefined()
	})
})
