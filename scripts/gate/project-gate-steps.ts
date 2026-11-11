import { existsSync } from 'node:fs'
import { SHELL_ARGUMENTS } from '#scripts/lane/lane-setup'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { package_manifest, type GateStepDefinition } from '#scripts/lib/package-manifest'
import { z } from 'zod'
import { gate_checks } from './gate-checks'
import type { GateStep, GateStepResult } from './gate-report'
import { gate_run_steps } from './gate-run-steps'
import { project_step_reuse, type StepRecords } from './project-step-reuse'

// The project's own gate steps, declared in its `package.json` (`josh.gate.steps`), run after the
// fixed checks (joshuafolkken/kit#7208).
//
// kit's checks know TypeScript; a project with a Rust crate or a Godot scene has checks only it knows.
// Each step is one shell command run through `pnpm exec --shell-mode` from the project root, one at a
// time in declared order, and reported under its `name` like any fixed check. A definition the schema
// rejects is not skipped: it comes back as one failed result, so the gate is red and says why.
// A step with `paths` runs only when a path it names moved since it last passed (`project-step-reuse.ts`).

const DEFINITION_LABEL = 'josh.gate.steps'
const SEQUENTIAL = 1
const PROJECT_STEPS_GROUP = 'rest'

type GateStepsManifest = z.infer<typeof package_manifest.josh_schemas.gate_steps>

type ProjectSteps = { steps: ReadonlyArray<GateStepDefinition> } | { error: string }

// A step's name is its label, and the gate keeps a check's green record by label (`check-reuse.ts`):
// a project step named `lint` would write, or reuse, the lint check's record.
const RESERVED_LABELS = new Set([
	...gate_checks.GATE_CHECKS.map((check) => check.label),
	DEFINITION_LABEL,
])

// The name is also part of the step's green record file name (`check-reuse.ts`), so a `/` or a leading
// `.` would point that record outside the record directory.
const STEP_NAME = /^\w[\w.-]*$/u

function names_of(steps: ReadonlyArray<GateStepDefinition>): string {
	return steps.map((step) => step.name).join(', ')
}

// Why the step names are refused, or `undefined` when every name is usable.
function name_refusal(steps: ReadonlyArray<GateStepDefinition>): string | undefined {
	const reserved = steps.filter((step) => RESERVED_LABELS.has(step.name))

	if (reserved.length > 0) {
		return `step names ${names_of(reserved)} are the gate's own check labels; the reserved names are ${[...RESERVED_LABELS].join(', ')}`
	}

	const unsafe = steps.filter((step) => !STEP_NAME.test(step.name))

	return unsafe.length > 0
		? `step names ${names_of(unsafe)} must start with a letter, digit or _ and hold only those, . and -`
		: undefined
}

function steps_of(manifest: GateStepsManifest): ReadonlyArray<GateStepDefinition> {
	const steps = manifest.josh?.gate?.steps ?? []
	const refusal = name_refusal(steps)

	if (refusal !== undefined) throw new Error(refusal)

	return steps
}

function describe_error(error: unknown): string {
	if (error instanceof z.ZodError) return z.prettifyError(error)

	return error instanceof Error ? error.message : String(error)
}

function read_project_steps(directory: string): ProjectSteps {
	if (!existsSync(package_manifest.manifest_path(directory))) return { steps: [] }

	try {
		return {
			steps: steps_of(
				package_manifest.read_manifest(directory, package_manifest.josh_schemas.gate_steps),
			),
		}
	} catch (error) {
		return { error: describe_error(error) }
	}
}

function definition_failure(directory: string, error: string): GateStepResult {
	return {
		label: DEFINITION_LABEL,
		command: 'josh gate',
		output: `The \`josh.gate.steps\` in ${package_manifest.manifest_path(directory)} is invalid, so no project step ran:\n${error}`,
		exit_code: FAIL_EXIT_CODE,
		elapsed_ms: 0,
	}
}

function to_gate_step(name: string, command: string, directory: string): GateStep {
	return { label: name, command_args: [...SHELL_ARGUMENTS, command], cwd: directory }
}

async function run_steps(
	steps: ReadonlyArray<GateStepDefinition>,
	reused: ReadonlyMap<string, string>,
	directory: string,
): Promise<ReadonlyArray<GateStepResult>> {
	return await bounded_pool.bounded_map(steps, SEQUENTIAL, async (step) => {
		const gate_step = to_gate_step(step.name, step.command, directory)
		const reused_at = reused.get(step.name)

		if (reused_at !== undefined) return gate_run_steps.reused_result(gate_step, reused_at)

		return await gate_run_steps.run_gate_step(gate_step)
	})
}

/**
 * Run the project's `josh.gate.steps` in declared order and answer their results.
 *
 * Unset, nothing runs and the gate is what it always was. An invalid definition answers one failed
 * `josh.gate.steps` result naming what the schema rejected. With `reuse`, a step whose `paths` no path
 * moved under since it last passed is reused rather than run (`project-step-reuse.ts`).
 */
async function run_project_steps(
	directory: string = process.cwd(),
	reuse?: StepRecords,
): Promise<ReadonlyArray<GateStepResult>> {
	const read = read_project_steps(directory)
	if ('error' in read) return [definition_failure(directory, read.error)]
	if (reuse === undefined) return await run_steps(read.steps, new Map(), directory)

	const reused = await project_step_reuse.reusable_steps(read.steps, reuse)
	const results = await run_steps(read.steps, reused, directory)

	await project_step_reuse.record_green_steps(read.steps, results, reuse)

	return results
}

interface StepRun {
	static_group?: string | undefined
	is_forced?: boolean | undefined
}

// A CI matrix splits the static checks into legs (`gate-static-group.ts`); the project steps run once,
// on the light `rest` leg, rather than on every leg.
async function run_for(
	run: StepRun,
	reuse: Omit<StepRecords, 'is_forced'>,
): Promise<ReadonlyArray<GateStepResult>> {
	const { static_group } = run

	if (static_group !== undefined && static_group !== PROJECT_STEPS_GROUP) return []

	return await run_project_steps(process.cwd(), { ...reuse, is_forced: run.is_forced === true })
}

const project_gate_steps = { run_for, run_project_steps }

export { DEFINITION_LABEL, project_gate_steps }
