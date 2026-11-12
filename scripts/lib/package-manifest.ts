import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ancestor_directories } from './ancestor-directories'
import { json_value } from './json-value'
import { file_reader } from './read-file'

// The one place a `package.json` is named and read. Readers across `scripts/` had each spelled the
// file name and written their own read-then-parse; they now ask here, and choose only how a manifest
// that cannot be read answers.
const PACKAGE_JSON = 'package.json'
const REVIEW_GATE_SCHEMA = z.enum(['ci', 'local'])
const FORMAT_SCHEMA = z.enum(['auto', 'all'])
const LANE_SCHEMA = z.object({ setup: z.string().min(1) })
// A project gate step: its name is the label the gate reports it under, so names are unique.
const GATE_STEP_SCHEMA = z.strictObject({
	name: z.string().min(1),
	command: z.string().min(1),
	paths: z.array(z.string().min(1)).min(1).optional(),
	cores: z.int().positive().optional(),
})
const GATE_STEPS_SCHEMA = z
	.array(GATE_STEP_SCHEMA)
	.refine((steps) => new Set(steps.map((step) => step.name)).size === steps.length, {
		message: 'step names must be unique',
	})
const GATE_SCHEMA = z.object({ steps: GATE_STEPS_SCHEMA.optional() })
// A worker profile a lane may run on: `profiles` runs weakest first, which is the escalation order.
// The model and effort are checked against the agent rules by `agent-worker-profile.ts`.
const WORKER_PROFILE_SCHEMA = z.strictObject({
	name: z.string().min(1),
	model: z.string().min(1),
	effort: z.string().min(1),
	when: z.string().min(1),
})
const WORKER_PROFILES_SCHEMA = z
	.array(WORKER_PROFILE_SCHEMA)
	.min(1)
	.refine((profiles) => new Set(profiles.map((profile) => profile.name)).size === profiles.length, {
		message: 'profile names must be unique',
	})
const WORKER_SCHEMA = z
	.strictObject({
		default: z.string().min(1),
		escalate: z.boolean().default(false),
		profiles: WORKER_PROFILES_SCHEMA,
	})
	.refine((worker) => worker.profiles.some((profile) => profile.name === worker.default), {
		message: 'default must name one of the profiles',
	})
const josh_schemas = {
	format: z.object({ josh: z.object({ format: FORMAT_SCHEMA.optional() }).optional() }),
	gate_steps: z.object({ josh: z.object({ gate: GATE_SCHEMA.optional() }).optional() }),
	lane_setup: z.object({ josh: z.object({ lane: LANE_SCHEMA.optional() }).optional() }),
	progress_interval_minutes: z.object({
		josh: z.object({ progress_interval_minutes: z.number().positive() }).optional(),
	}),
	review_gate: z.object({ josh: z.object({ review_gate: REVIEW_GATE_SCHEMA }).optional() }),
	worker: z.object({ josh: z.object({ worker: WORKER_SCHEMA.optional() }).optional() }),
}

function manifest_path(directory: string): string {
	return path.join(directory, PACKAGE_JSON)
}

// For a manifest that must exist: a missing file, text that is not JSON and a shape the schema
// rejects all throw, so the defect surfaces where it was met.
function read_manifest<T>(directory: string, schema: z.ZodType<T>): T {
	const text = readFileSync(manifest_path(directory), 'utf8')

	return schema.parse(JSON.parse(text))
}

// For a manifest that may be absent or broken without that being this reader's failure: every one of
// those answers `undefined`.
function read_manifest_if_valid<T>(directory: string, schema: z.ZodType<T>): T | undefined {
	const text = file_reader.read_if_readable(manifest_path(directory))
	if (text === undefined) return undefined

	return json_value.parse_with(text, schema)
}

function read_nearest_value<T, Value>(
	start: string,
	schema: z.ZodType<T>,
	select: (manifest: T) => Value | undefined,
): Value | undefined {
	const value_schema = schema.transform(select)

	for (const directory of ancestor_directories.list(start)) {
		const value = read_manifest_if_valid(directory, value_schema)
		if (value !== undefined) return value
	}

	return undefined
}

const package_manifest = {
	josh_schemas,
	manifest_path,
	read_manifest,
	read_manifest_if_valid,
	read_nearest_value,
}

type GateStepDefinition = z.infer<typeof GATE_STEP_SCHEMA>
type FormatScope = z.infer<typeof FORMAT_SCHEMA>
type WorkerConfig = z.infer<typeof WORKER_SCHEMA>
type WorkerProfileDefinition = z.infer<typeof WORKER_PROFILE_SCHEMA>

export type { FormatScope, GateStepDefinition, WorkerConfig, WorkerProfileDefinition }
export { PACKAGE_JSON, REVIEW_GATE_SCHEMA, package_manifest }
