import { hook_launch } from '#scripts/init/hook-launch'

// `.codex/hooks.json` is derived from `.claude/settings.json`, never written by hand.
// The hand copy carried every hook command twice, so a change to one side
// left the other silently stale. Codex differs from Claude Code in three places only, and each is a
// rule applied here rather than a line maintained in the copy:
//
// 1. The pretool and posttool handlers run through the Codex input adapter, which translates the
//    `apply_patch` payload into the Edit/Write shape the Claude-side guards read.
// 2. The PreToolUse and PostToolUse matchers also select `apply_patch`, Codex's edit tool.
// 3. UserPromptSubmit carries no matcher — Codex documents that the event ignores it.

interface HookHandler {
	type: string
	command: string
	timeout?: number
}

interface MatcherGroup {
	matcher?: string
	hooks: Array<HookHandler>
}

type HookEvents = Record<string, Array<MatcherGroup>>

interface HookConfig {
	hooks: HookEvents
}

const CODEX_EDIT_TOOL = 'apply_patch'
const TOOL_EVENTS: ReadonlySet<string> = new Set(['PreToolUse', 'PostToolUse'])
const UNMATCHED_EVENTS: ReadonlySet<string> = new Set(['UserPromptSubmit'])
const JSON_INDENT = '\t'

function adapter_command(mode: string): string {
	return hook_launch.hook_launch_command(`codex-hook-adapter ${mode}`)
}

// Each Claude-side guard command the adapter stands in for, keyed by that command verbatim.
const ADAPTED_COMMANDS: ReadonlyMap<string, string> = new Map([
	[hook_launch.hook_launch_command('pretool-guard'), adapter_command('pretool')],
	[hook_launch.hook_launch_command('format-edited'), adapter_command('posttool')],
])

function codex_handler(handler: HookHandler): HookHandler {
	return { ...handler, command: ADAPTED_COMMANDS.get(handler.command) ?? handler.command }
}

function codex_matcher(event: string, matcher: string | undefined): string | undefined {
	if (UNMATCHED_EVENTS.has(event)) return undefined
	if (matcher !== undefined && TOOL_EVENTS.has(event)) return `${matcher}|${CODEX_EDIT_TOOL}`

	return matcher
}

function codex_group(event: string, group: MatcherGroup): MatcherGroup {
	const matcher = codex_matcher(event, group.matcher)
	const hooks = group.hooks.map((handler) => codex_handler(handler))

	return matcher === undefined ? { hooks } : { matcher, hooks }
}

function codex_hook_config(claude: HookConfig): HookConfig {
	const events = Object.entries(claude.hooks).map(([event, groups]) => [
		event,
		groups.map((group) => codex_group(event, group)),
	])

	return { hooks: Object.fromEntries(events) as HookEvents }
}

// The file text `.codex/hooks.json` holds — the formatter's own output for this JSON, so a write
// followed by `pnpm josh format:edited` leaves it byte-identical.
function codex_hooks_text(claude_settings_text: string): string {
	const claude = JSON.parse(claude_settings_text) as HookConfig

	return `${JSON.stringify(codex_hook_config(claude), undefined, JSON_INDENT)}\n`
}

const codex_hooks = { adapter_command, codex_hook_config, codex_hooks_text }

export { codex_hooks }
export type { HookConfig }
