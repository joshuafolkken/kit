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
const LANE_SCHEMA = z.object({ setup: z.string().min(1) })
const josh_schemas = {
	lane_setup: z.object({ josh: z.object({ lane: LANE_SCHEMA.optional() }).optional() }),
	progress_interval_minutes: z.object({
		josh: z.object({ progress_interval_minutes: z.number().positive() }).optional(),
	}),
	review_gate: z.object({ josh: z.object({ review_gate: REVIEW_GATE_SCHEMA }).optional() }),
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

export { PACKAGE_JSON, REVIEW_GATE_SCHEMA, package_manifest }
