import path from 'node:path'
import { hook_decision } from '#scripts/josh/hook-decision'
import { json_value } from '#scripts/lib/json-value'
import { test_declared_logic } from '#scripts/test/test-declared-logic'

// The Code Change Rules Step 0 reminder, delivered at the moment implementation code is about to be
// written rather than on every prompt. As a `UserPromptSubmit` echo it was
// injected into every turn — a question that writes nothing included — and re-read as accumulated
// context on each turn after it. The trigger the rule names is "before writing any implementation
// code", so the hook that delivers it is the one that sees that write: the first `Edit` / `Write` of a
// runtime file in the session.
//
// **A runtime file only.** What counts is `test_declared_logic.is_exempt`, the same classification
// `pnpm josh test:declared` answers at the commit, so a doc or prompt edit neither shows the notice nor
// spends it. A path outside the working tree (a memory file, a scratchpad) is not this project's code.
//
// **Once per session**, on a stamp keyed by the transcript like every other guard record here. A stamp
// that cannot be written stays silent rather than repeating the notice on every edit.
const STAMP_PREFIX = 'josh-step-zero-notice-'
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])
const PARENT_PREFIX = '..'

const NOTICE =
	'Before writing any implementation code: present the two-layer work summary (Now / Change / Check, then every change with its test) once per Issue. Full rule: Code Change Rules Step 0 in CLAUDE.md.'

const STAMP = hook_decision.create_refusal_stamp(STAMP_PREFIX)

// A Codex `apply_patch` arrives translated with its first file as `file_path` and every file in
// `file_paths`, so a patch that leads with a doc and also writes code is still a runtime write.
function edited_paths(tool_input: unknown): Array<string> {
	if (!json_value.is_record(tool_input)) return []

	const { file_path, file_paths } = tool_input
	const listed: ReadonlyArray<unknown> = Array.isArray(file_paths) ? file_paths : []

	return [file_path, ...listed].filter(
		(entry): entry is string => typeof entry === 'string' && entry.length > 0,
	)
}

function is_runtime_file(file_path: string, root: string): boolean {
	const relative = path.relative(root, path.resolve(root, file_path))

	if (relative.startsWith(PARENT_PREFIX) || path.isAbsolute(relative)) return false

	return !test_declared_logic.is_exempt(relative.split(path.sep).join('/'))
}

function is_candidate(raw_payload: string, root: string): string | undefined {
	const payload = hook_decision.parse_hook_payload(raw_payload)

	if (payload === undefined || !EDIT_TOOLS.has(payload.tool_name)) return undefined

	const has_runtime_file = edited_paths(payload.tool_input).some((file_path) =>
		is_runtime_file(file_path, root),
	)

	return has_runtime_file ? payload.transcript_path : undefined
}

function notice(raw_payload: string, root: string = process.cwd()): string | undefined {
	const transcript = is_candidate(raw_payload, root)

	if (transcript === undefined) return undefined

	const target = STAMP.path(transcript)

	if (STAMP.last_ms(target) !== hook_decision.NEVER_MS) return undefined
	if (!STAMP.record(target, Date.now())) return undefined

	return NOTICE
}

const step_zero_notice = { NOTICE, notice, stamp_path: STAMP.path }

export { step_zero_notice }
