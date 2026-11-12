import { readFile } from 'node:fs/promises'
import { split_assess } from '#scripts/split/split-assess'
import { z } from 'zod'
import type { LanePlan } from './lane-plan'

// Selected consumers, distributed docs and verification fixtures share the actual-size calculator.
// A reference alone implies neither an edit nor an independently mergeable split boundary.
const FLAG = '--estimate'
const FLAG_WIDTH = 2
const change_schema = z.object({
	path: z.string().trim().min(1),
	changed_lines: z.number().int().nonnegative(),
})
const schema = z.object({
	changes: z.array(change_schema),
	added: z.array(z.string()).default([]),
})

function split(tokens: ReadonlyArray<string>): { tokens: Array<string>; file?: string } {
	const at = tokens.indexOf(FLAG)
	if (at === -1) return { tokens: [...tokens] }
	if (tokens.lastIndexOf(FLAG) !== at) throw new Error('duplicate --estimate')
	const file = tokens[at + 1]
	if (file === undefined || file.startsWith('--')) throw new Error('--estimate needs a JSON file')

	return { tokens: [...tokens.slice(0, at), ...tokens.slice(at + FLAG_WIDTH)], file }
}

async function read(file: string): Promise<z.infer<typeof schema>> {
	const scope = schema.parse(JSON.parse(await readFile(file, 'utf8')))
	const paths = scope.changes.map((change) => change.path)
	if (new Set(paths).size !== paths.length) throw new Error('duplicate estimate path')

	if (scope.added.some((path) => !paths.includes(path))) {
		throw new Error('added path needs an estimate')
	}

	return scope
}

async function attach(plan: LanePlan, file: string | undefined): Promise<LanePlan> {
	if (file === undefined) return plan
	const scope = await read(file)
	const paths = scope.changes.map((change) => change.path)

	if (plan.paths.some((path) => !paths.includes(path))) {
		throw new Error('planned path needs an estimate')
	}

	const size = split_assess.measure(scope.changes, undefined, new Set(scope.added))

	return { ...plan, paths, estimated_size: { files: size.files, lines: size.lines } }
}

const lane_plan_estimate = { attach, read, split }

export { lane_plan_estimate }
