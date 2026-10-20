import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { json_value } from './json-value'
import { file_reader } from './read-file'

// The one place a `package.json` is named and read. Readers across `scripts/` had each spelled the
// file name and written their own read-then-parse; they now ask here, and choose only how a manifest
// that cannot be read answers.
const PACKAGE_JSON = 'package.json'

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

const package_manifest = { manifest_path, read_manifest, read_manifest_if_valid }

export { PACKAGE_JSON, package_manifest }
