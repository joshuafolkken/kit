import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { SHELL_ARGUMENTS } from '#scripts/lane/lane-setup'
import { FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GateStep, GateStepResult } from './gate-report'
import { gate_run_steps } from './gate-run-steps'
import type { GateTree } from './gate-tree'
import { DEFINITION_LABEL, project_gate_steps } from './project-gate-steps'
import { project_step_reuse } from './project-step-reuse'

const CARGO = { name: 'cargo', command: 'cargo test', paths: ['src/**/*.rs'] }
const GODOT = { name: 'godot', command: 'godot --check' }
const TREE: GateTree = { files: {}, base: undefined }

// A fresh project root, with a `package.json` holding `manifest` unless it is undefined.
function project_root(manifest?: unknown): string {
	const directory = temporary_directory()('project-gate-steps-')

	if (manifest !== undefined) {
		writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
	}

	return directory
}

function steps_manifest(steps: ReadonlyArray<unknown>): unknown {
	return { josh: { gate: { steps } } }
}

function result_of(step: GateStep, exit_code: number): GateStepResult {
	return {
		label: step.label,
		command: step.command_args.join(' '),
		output: '',
		exit_code,
		elapsed_ms: 0,
	}
}

function stub_runs(failing: ReadonlyArray<string> = []): Array<GateStep> {
	const ran: Array<GateStep> = []

	vi.spyOn(gate_run_steps, 'run_gate_step').mockImplementation(async (step) => {
		ran.push(step)

		return await result_of(step, failing.includes(step.label) ? FAIL_EXIT_CODE : 0)
	})

	return ran
}

function outcomes(results: ReadonlyArray<GateStepResult>): ReadonlyArray<[string, number]> {
	return results.map((result) => [result.label, result.exit_code ?? FAIL_EXIT_CODE])
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_project_steps — declared steps', () => {
	it('runs nothing when the manifest declares no steps, or there is no manifest', async () => {
		const ran = stub_runs()
		const lane_only = project_root({ josh: { lane: { setup: 'x' } } })

		expect(await project_gate_steps.run_project_steps(project_root())).toStrictEqual([])
		expect(await project_gate_steps.run_project_steps(lane_only)).toStrictEqual([])
		expect(ran).toStrictEqual([])
	})

	it('runs each step through the shell from the project root, in declared order', async () => {
		const directory = project_root(steps_manifest([CARGO, GODOT]))
		const ran = stub_runs()

		const results = await project_gate_steps.run_project_steps(directory)

		expect(ran).toStrictEqual([
			{ label: CARGO.name, command_args: [...SHELL_ARGUMENTS, CARGO.command], cwd: directory },
			{ label: GODOT.name, command_args: [...SHELL_ARGUMENTS, GODOT.command], cwd: directory },
		])
		expect(outcomes(results)).toStrictEqual([
			[CARGO.name, 0],
			[GODOT.name, 0],
		])
	})

	it('reports a failing step under its name and still runs the rest', async () => {
		stub_runs([CARGO.name])
		const directory = project_root(steps_manifest([CARGO, GODOT]))

		const results = await project_gate_steps.run_project_steps(directory)

		expect(outcomes(results)).toStrictEqual([
			[CARGO.name, FAIL_EXIT_CODE],
			[GODOT.name, 0],
		])
	})
})

describe('run_project_steps — invalid definitions', () => {
	it.each([
		['an empty name', [{ name: '', command: 'true' }], 'name'],
		['an unknown key', [{ ...GODOT, when: 'always' }], 'when'],
		['a duplicated name', [GODOT, GODOT], 'step names must be unique'],
		['empty paths', [{ ...GODOT, paths: [] }], 'paths'],
		['a fixed check label', [{ ...GODOT, name: 'lint' }], "lint are the gate's own check labels"],
		['the definition label', [{ ...GODOT, name: DEFINITION_LABEL }], DEFINITION_LABEL],
	])('rejects %s as one failed definition result, running nothing', async (_case, steps, named) => {
		const ran = stub_runs()

		const results = await project_gate_steps.run_project_steps(project_root(steps_manifest(steps)))

		expect(ran).toStrictEqual([])
		expect(outcomes(results)).toStrictEqual([[DEFINITION_LABEL, FAIL_EXIT_CODE]])
		expect(results[0]?.output).toContain(named)
	})
})

describe('run_project_steps — reuse', () => {
	it('reuses the steps whose records hold and runs the rest', async () => {
		const ran = stub_runs()
		const at = '2026-11-11T00:00:00.000Z'
		const reuse = { tree: TREE, records: undefined, is_forced: false }

		vi.spyOn(project_step_reuse, 'reusable_steps').mockResolvedValue(new Map([[CARGO.name, at]]))
		const record = vi.spyOn(project_step_reuse, 'record_green_steps').mockResolvedValue()

		const results = await project_gate_steps.run_project_steps(
			project_root(steps_manifest([CARGO, GODOT])),
			reuse,
		)

		expect(ran.map((step) => step.label)).toStrictEqual([GODOT.name])
		expect(results.map((result) => result.reused_at)).toStrictEqual([at, undefined])
		expect(record).toHaveBeenCalledWith([CARGO, GODOT], results, reuse)
	})
})

describe('run_for', () => {
	it('runs the project steps on a whole gate and the rest leg only', async () => {
		vi.spyOn(process, 'cwd').mockReturnValue(project_root(steps_manifest([GODOT])))
		const ran = stub_runs()
		const reuse = { tree: TREE, records: undefined }

		await project_gate_steps.run_for({ static_group: 'types' }, reuse)
		await project_gate_steps.run_for({ static_group: 'rest' }, reuse)
		await project_gate_steps.run_for({}, reuse)

		expect(ran.map((step) => step.label)).toStrictEqual([GODOT.name, GODOT.name])
	})
})
