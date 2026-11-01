import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { agent_consultation_model } from '#scripts/agent/agent-consultation-model'
import { find_package_directory } from '#scripts/josh/package-directory'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { agent_model } from './agent-model'
import { broad_investigation_shell } from './broad-investigation-shell'

// Which tool calls are broad investigation (joshuafolkken/kit#5351) — the reading a consultation main
// line hands to a subagent instead of paying its own rate for. The shell half is
// `broad-investigation-shell.ts`.

const { READ_LINE_CAP, is_broad_command, is_file } = broad_investigation_shell

const ALWAYS_BROAD: ReadonlySet<string> = new Set(['Glob', 'WebFetch'])
const GENERAL_PURPOSE = 'general-purpose'
// The dispatches that investigate: the read-only unit and the two catch-all types.
const INVESTIGATION_AGENTS: ReadonlySet<string> = new Set([
	'investigator',
	'Explore',
	GENERAL_PURPOSE,
])
const FRONTMATTER_MODEL = /^model:\s*(?<model>\S+)\s*$/mu
const PACKAGE_DIRECTORY = find_package_directory(path.dirname(fileURLToPath(import.meta.url)))

function field(call: GuardedCall, key: string): unknown {
	return json_value.is_record(call.input) ? call.input[key] : undefined
}

function is_broad_read(call: GuardedCall): boolean {
	const limit = field(call, 'limit')

	return typeof limit !== 'number' || limit > READ_LINE_CAP
}

// A `Grep` is narrow only when its `path` is one file.
function is_broad_grep(call: GuardedCall): boolean {
	const target = field(call, 'path')

	return typeof target !== 'string' || !is_file(target)
}

// The model an agent definition names, read from the kit's own `.claude/agents/` (`kit:investigator`
// in a consumer is the same file); `undefined` for a built-in type, which inherits.
function definition_model(name: string): string | undefined {
	const file = path.join(PACKAGE_DIRECTORY, '.claude', 'agents', `${name}.md`)
	const body = is_file(file) ? readFileSync(file, 'utf8') : ''

	return FRONTMATTER_MODEL.exec(body)?.groups?.['model']
}

// The dispatched type without its plugin prefix (`kit:investigator` → `investigator`).
function agent_name(call: GuardedCall): string {
	const type = field(call, 'subagent_type')
	if (typeof type !== 'string') return GENERAL_PURPOSE

	return type.split(':').at(-1) ?? type
}

function effective_model(call: GuardedCall, name: string): string | undefined {
	const named = field(call, 'model')

	return typeof named === 'string' && named.length > 0 ? named : definition_model(name)
}

// An investigation dispatch's effective model — its `model`, else its definition's; `undefined` for
// a non-investigation call or one inheriting the main line's own.
function dispatched_model(call: GuardedCall): string | undefined {
	return effective_model(call, agent_name(call))
}

function is_investigation_dispatch(call: GuardedCall): boolean {
	return agent_model.SUBAGENT_TOOLS.has(call.name) && INVESTIGATION_AGENTS.has(agent_name(call))
}

function is_consultation(model: string | undefined): boolean {
	return model === undefined || agent_consultation_model.consultation_provider(model) !== undefined
}

// An investigation dispatch whose effective model would be the consultation model.
function inherits_consultation(call: GuardedCall): boolean {
	if (!INVESTIGATION_AGENTS.has(agent_name(call))) return false

	return is_consultation(dispatched_model(call))
}

// The kept form: the investigation handed to a unit on a model other than the consultation one.
function is_delegated_investigation(call: GuardedCall): boolean {
	return is_investigation_dispatch(call) && !is_consultation(dispatched_model(call))
}

const TOOL_TESTS: ReadonlyMap<string, (call: GuardedCall) => boolean> = new Map([
	['Read', is_broad_read],
	['Grep', is_broad_grep],
	['Bash', (call: GuardedCall): boolean => is_broad_command(time_shell.bash_command(call.input))],
	...[...agent_model.SUBAGENT_TOOLS].map((name): [string, (call: GuardedCall) => boolean] => [
		name,
		inherits_consultation,
	]),
])

function is_broad_investigation(call: GuardedCall): boolean {
	if (ALWAYS_BROAD.has(call.name)) return true

	return TOOL_TESTS.get(call.name)?.(call) === true
}

const broad_investigation = { READ_LINE_CAP, is_broad_investigation, is_delegated_investigation }

export { broad_investigation }
