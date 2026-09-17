#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision, type GuardOutcome } from '#scripts/josh/hook-decision'
import { z } from 'zod'
import { density_envelope, format_edited_payload } from './format-edited-file'
import { pretool_guard } from './pretool-guard'

const APPLY_PATCH_TOOL = 'apply_patch'
const EDIT_TOOL = 'Edit'
const WRITE_TOOL = 'Write'
const PRETOOL_MODE = 'pretool'
const POSTTOOL_MODE = 'posttool'
const MODE_ARGUMENT_INDEX = 2
const PATCH_FILE_PATTERN = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/gmu
const PATCH_MOVE_PATTERN = /^\*\*\* Move to: (.+)$/gmu

// Codex deliberately reports its canonical tool name even when an Edit or Write matcher selected
// the hook. Its apply_patch body is `tool_input.command`; the Claude-shaped handlers downstream
// instead classify Edit/Write and read `tool_input.file_path`. This module is the only translation
// boundary between those provider contracts.
const codex_payload_schema = z.looseObject({
	tool_name: z.string().min(1),
	tool_input: z.unknown(),
})
const patch_input_schema = z.object({ command: z.string().min(1) })

type PayloadFormatter = (raw_payload: string, project_root: string) => Promise<void>

function parse_payload(raw_payload: string): z.infer<typeof codex_payload_schema> | undefined {
	try {
		const parsed = codex_payload_schema.safeParse(JSON.parse(raw_payload))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

function paths_matching(command: string, pattern: RegExp): Array<string> {
	return [...command.matchAll(pattern)].flatMap((match) => {
		const file_path = match[1]?.trim()

		return file_path === undefined || file_path === '' ? [] : [file_path]
	})
}

function patch_paths(tool_input: unknown): Array<string> {
	const parsed = patch_input_schema.safeParse(tool_input)
	if (!parsed.success) return []
	const paths = [
		...paths_matching(parsed.data.command, PATCH_FILE_PATTERN),
		...paths_matching(parsed.data.command, PATCH_MOVE_PATTERN),
	]

	return [...new Set(paths)]
}

function canonical_payload(
	payload: z.infer<typeof codex_payload_schema>,
	tool_name: string,
	file_path: string,
): string {
	return JSON.stringify({ ...payload, tool_name, tool_input: { file_path } })
}

function pretool_payload(raw_payload: string): string {
	const payload = parse_payload(raw_payload)
	if (payload?.tool_name !== APPLY_PATCH_TOOL) return raw_payload
	const paths = patch_paths(payload.tool_input)
	const [file_path] = paths
	if (file_path === undefined) return raw_payload
	// A multi-file patch cannot be represented by one Claude Edit target. Route it through Write's
	// non-blocking notice path rather than let the guard refuse using an incomplete dependency set.
	const tool_name = paths.length === 1 ? EDIT_TOOL : WRITE_TOOL

	return canonical_payload(payload, tool_name, file_path)
}

function posttool_payloads(raw_payload: string): Array<string> {
	const payload = parse_payload(raw_payload)
	if (payload?.tool_name !== APPLY_PATCH_TOOL) return [raw_payload]

	return patch_paths(payload.tool_input).map((file_path) =>
		canonical_payload(payload, EDIT_TOOL, file_path),
	)
}

function pretool_outcome(raw_payload: string): GuardOutcome {
	return pretool_guard.pretool_outcome(pretool_payload(raw_payload))
}

async function format_posttool_payloads(
	raw_payload: string,
	project_root: string,
	formatter: PayloadFormatter = format_edited_payload,
): Promise<void> {
	for (const payload of posttool_payloads(raw_payload)) await formatter(payload, project_root)
}

function write_density(raw_payload: string): void {
	const envelope = density_envelope(raw_payload)

	if (envelope !== undefined) process.stdout.write(`${envelope}\n`)
}

async function run(raw_payload: string, mode: string): Promise<void> {
	if (mode === PRETOOL_MODE) {
		hook_decision.write_outcome(raw_payload, pretool_outcome)

		return
	}

	if (mode === POSTTOOL_MODE) {
		write_density(raw_payload)
		await format_posttool_payloads(raw_payload, process.cwd())

		return
	}

	process.stderr.write(`codex-hook-adapter expects ${PRETOOL_MODE} or ${POSTTOOL_MODE}.\n`)
	process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await run(await text(process.stdin), process.argv[MODE_ARGUMENT_INDEX] ?? '')
}

const codex_hook_adapter = {
	format_posttool_payloads,
	patch_paths,
	posttool_payloads,
	pretool_outcome,
	pretool_payload,
}

export { codex_hook_adapter }
export type { PayloadFormatter }
