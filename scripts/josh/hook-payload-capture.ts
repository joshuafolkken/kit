import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The raw stdin payload a hook was handed, kept on disk when `JOSH_HOOK_CAPTURE_DIR` names a directory
// (joshuafolkken/kit#6588). Claude Code and Codex hand the same hook differently shaped payloads, and
// the replay test (`scripts/hooks/hook-payload-replay.test.ts`) runs the fixtures captured this way
// through the guards, so a provider's real input is pinned before a review lane meets it.
//
// **Capturing never decides the call.** A directory that cannot be written leaves the hook exactly as
// it was without the variable.

const CAPTURE_DIR_KEY = 'JOSH_HOOK_CAPTURE_DIR'
const NO_TOOL = 'none'
const FILE_EXTENSION = '.json'
const UNSAFE_NAME_CHARACTERS = /[^\w.-]/gu
// More parallel calls than one turn issues, so a collision never runs out of indexes.
const MAX_ATTEMPTS = 32

const tool_schema = z.looseObject({ tool_name: z.string().min(1) })

function safe_name(name: string): string {
	return name.replaceAll(UNSAFE_NAME_CHARACTERS, '-')
}

function tool_label(raw_payload: string): string {
	return safe_name(json_value.parse_with(raw_payload, tool_schema)?.tool_name ?? NO_TOOL)
}

function write_new(file: string, raw_payload: string): boolean {
	try {
		writeFileSync(file, raw_payload, { flag: 'wx' })

		return true
	} catch {
		return false
	}
}

// `<hook>-<tool>-<n>.json`, `n` counted from one past the captures of that hook and tool already in
// `directory`. Parallel tool calls run their hooks at once and a moved capture leaves a gap, so a
// taken `n` moves on to the next rather than dropping the payload.
function write_capture(directory: string, hook: string, raw_payload: string): string | undefined {
	const prefix = `${safe_name(hook)}-${tool_label(raw_payload)}-`
	const first = readdirSync(directory).filter((name) => name.startsWith(prefix)).length + 1

	for (let index = first; index < first + MAX_ATTEMPTS; index += 1) {
		const file = path.join(directory, `${prefix}${String(index)}${FILE_EXTENSION}`)

		if (write_new(file, raw_payload)) return file
	}

	return undefined
}

// The file written, or undefined when capture is off or the directory could not take it.
function capture(
	hook: string,
	raw_payload: string,
	environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const directory = environment[CAPTURE_DIR_KEY]
	if (directory === undefined || directory === '') return undefined

	try {
		mkdirSync(directory, { recursive: true })

		return write_capture(directory, hook, raw_payload)
	} catch {
		// A directory that cannot be made or listed: the call goes on uncaptured.
		return undefined
	}
}

const hook_payload_capture = { CAPTURE_DIR_KEY, capture }

export { hook_payload_capture }
