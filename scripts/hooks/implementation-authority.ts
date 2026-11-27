import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_tool_payload } from '#scripts/josh/hook-tool-payload'
import { lane_paths } from '#scripts/lane/lane-paths'
import { json_value } from '#scripts/lib/json-value'
import { last_prompt } from '#scripts/rules/last-prompt'
import { unasked_filing } from '#scripts/rules/unasked-filing'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { z } from 'zod'
import { hook_context, type HookContext } from './hook-context'
import { implementation_shell } from './implementation-shell'
import { no_filing_declaration } from './no-filing-declaration'
import { step_zero_notice } from './step-zero-notice'

const HANDOFF =
	' Implementation refused before execution. Record the plan with issue:plan or issue:comment and hand it to lane:dispatch; repeating the request does not grant authority.'
const UNKNOWN =
	' Cannot verify the write targets of this shell or patch input. Use explicit Edit/Write paths for operational records, or hand implementation to a worker lane.'

const MATCHED = ' Matched rule: '

function edit_refusal(tool_input: unknown): string | undefined {
	return step_zero_notice.edited_paths(tool_input).length === 0 ? 'no edited path' : undefined
}

// The rule an unverified write matched (joshuafolkken/kit#5793), so a false refusal can be diagnosed.
function unverified_write(raw_payload: string): string | undefined {
	const payload = hook_tool_payload.parse(raw_payload)
	if (payload === undefined) return 'an unparsed hook payload'
	if (['apply_patch', 'exec'].includes(payload.tool_name)) return `\`${payload.tool_name}\` input`
	if (['Edit', 'Write'].includes(payload.tool_name)) return edit_refusal(payload.tool_input)
	if (payload.tool_name !== 'Bash') return undefined

	return implementation_shell.refusal(time_shell.bash_command(payload.tool_input))
}

// **A no-filing request is built by the production subagent** (joshuafolkken/kit#7761). The harness
// stamps `agent_id` and `agent_type` on a call made inside a subagent, and `transcript_path` names the
// parent's transcript. Only those harness fields and the person's own prompt line grant it — a tool
// result or a subagent's hand-back is not a person prompt (`last_prompt.person_prompt`). Shell writes
// keep their refusal (`implementation-shell.ts`).
//
// **The prompt that grants it is the one the producer was dispatched under**, not the person's latest:
// a prompt sent while the producer works would otherwise revoke it mid-task (joshuafolkken/kit#8248).
// The harness files the launch at `<session>/subagents/agent-<agent_id>.meta.json`, whose `toolUseId`
// names the parent's Agent call; with no such record or call, the edit is refused.
const PRODUCERS: ReadonlySet<string> = new Set(['producer', 'kit:producer'])

const SUBAGENT_CALL_SCHEMA = z.object({
	tool_name: z.enum(['Edit', 'Write']),
	tool_input: z.unknown(),
	agent_id: z.string().regex(/^[\w-]+$/u),
	agent_type: z.string(),
	transcript_path: z.string().min(1),
})

// **The producer builds in its own Claude Code worktree, never in the checkout** (joshuafolkken/kit#8973).
// A backlogrun's driver runs `main:sync` in the main checkout after every merge, and an uncommitted
// edit there to a file the merge touched aborts its `git pull` and stalls the whole run. Dispatched
// with `isolation: "worktree"`, the producer's paths sit under `.claude/worktrees/<name>`
// (`lane_paths.checkout_of`); any other path is refused, whatever the prompt granted. The check is
// for any worktree under `.claude/worktrees/`, not the producer's own: that is what keeps a synced
// checkout clean, and the hook's cwd does not name which worktree the producer was dispatched into.
const OUTSIDE_WORKTREE =
	' A producer edits only inside a worktree under `.claude/worktrees/` (`isolation: "worktree"`); this path is in a checkout a run syncs.'

function is_in_worktree(file_path: string, cwd: string): boolean {
	const resolved = path.resolve(cwd, file_path)

	return lane_paths.checkout_of(resolved) !== resolved
}

function is_producer_outside_worktree(raw_payload: string, cwd: string): boolean {
	const call = SUBAGENT_CALL_SCHEMA.safeParse(json_value.parse_or_undefined(raw_payload))
	if (!call.success || !PRODUCERS.has(call.data.agent_type)) return false

	return step_zero_notice
		.edited_paths(call.data.tool_input)
		.some((file_path) => !is_in_worktree(file_path, cwd))
}

const LAUNCH_SCHEMA = z.object({ toolUseId: z.string().min(1) })

function dispatch_id(transcript_path: string, agent_id: string): string | undefined {
	const session = transcript_path.replace(/\.jsonl$/u, '')
	const launch = path.join(session, 'subagents', `agent-${agent_id}.meta.json`)
	if (!existsSync(launch)) return undefined
	const parsed = LAUNCH_SCHEMA.safeParse(
		json_value.parse_or_undefined(readFileSync(launch, 'utf8')),
	)

	return parsed.data?.toolUseId
}

// **A session's no-filing declaration grants what the phrase would** (joshuafolkken/kit#9076), read
// after the dispatching prompt's own words: the declaration's end refuses even though it says no
// filing, the phrase itself still grants, and an explicit filing instruction wins for its own reply
// without ending the declaration (`no-filing-declaration.ts`).
function is_granted(prompt: string, transcript_path: string): boolean {
	if (no_filing_declaration.is_ending(prompt)) return false
	if (unasked_filing.is_no_filing(prompt)) return true
	if (unasked_filing.is_instructed(prompt)) return false

	return no_filing_declaration.is_declared(transcript_path)
}

function is_no_filing_production(raw_payload: string): boolean {
	const call = SUBAGENT_CALL_SCHEMA.safeParse(json_value.parse_or_undefined(raw_payload))
	if (!call.success || !PRODUCERS.has(call.data.agent_type)) return false
	const { transcript_path, agent_id } = call.data
	const tool_use_id = dispatch_id(transcript_path, agent_id)
	if (tool_use_id === undefined) return false
	const prompt = last_prompt.call_prompt_at(transcript_path, tool_use_id)

	return prompt !== undefined && is_granted(prompt, transcript_path)
}

// A granted edit names its paths, so it passes `unverified_write` too.
function is_refused_runtime_edit(raw_payload: string, cwd: string): boolean {
	if (!step_zero_notice.is_runtime_edit(raw_payload, cwd, true)) return false

	return !is_no_filing_production(raw_payload)
}

function edit_refusal_tail(raw_payload: string, cwd: string): string | undefined {
	if (is_producer_outside_worktree(raw_payload, cwd)) return OUTSIDE_WORKTREE

	return is_refused_runtime_edit(raw_payload, cwd) ? HANDOFF : undefined
}

function reason(
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): string | undefined {
	if (agent_session_role.can_implement(context.env)) return undefined

	const scope = agent_session_role.scope_line(context.env)
	const tail = edit_refusal_tail(raw_payload, context.cwd)

	if (tail !== undefined) return scope + tail

	const rule = unverified_write(raw_payload)
	if (rule === undefined) return undefined

	return `${scope}${HANDOFF}${UNKNOWN}${MATCHED}${rule}.`
}

const implementation_authority = { reason }

export { implementation_authority }
