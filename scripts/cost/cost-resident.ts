import { readdirSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/json-value'
import { prompt_hooks } from '#scripts/prompt-hooks'
import { file_reader } from '#scripts/read-file'
import { skill_meta } from '#scripts/skill-meta'
import { cost_tokens } from './cost-tokens'

// What the resident block is made of (joshuafolkken/kit#1151).
//
// `cost-report.ts` measures the resident block's size — the first request's whole billed input,
// re-read on every request after it. Measuring is not decomposing: 51,782 tokens per request was
// known for months while nobody could say how much of it was `CLAUDE.md`, so "where would trimming
// help" was a guess rather than a reading.
//
// **The transcript cannot decompose it, and this module does not pretend otherwise.** Claude Code
// writes no system prompt and no tool schemas to the transcript, so the only honest decomposition is
// from the other side: size the parts the repository itself controls, and report the difference from
// the measured baseline as one remainder that is named rather than distributed. Every row but the
// baseline is an estimate (`cost-tokens.ts`), and the report says so.

const CLAUDE_DOCUMENT = 'CLAUDE.md'
const SETTINGS_PATH = path.join('.claude', 'settings.json')
const MCP_PATH = '.mcp.json'
const HARNESS_LABEL = 'harness: system prompt, tool schemas, MCP instructions'
const HOOKS_LABEL = 'UserPromptSubmit hooks'
const SKILLS_LABEL = 'skills index (frontmatter)'

interface ResidentRow {
	source: string
	// Absent for the remainder, which is a difference between token counts and never had a size on
	// disk. Reported as 0 rather than omitted, so the JSON shape is the same for every row.
	bytes: number
	tokens: number
	is_estimated: boolean
}

interface ResidentBreakdown {
	// The measured anchor: the session's first request's whole billed input. Every other number here
	// is checked against it, which is what keeps the estimate honest — the remainder absorbs the
	// estimator's error instead of hiding it.
	baseline_tokens: number
	rows: Array<ResidentRow>
	// Declared in `.mcp.json`. Their tool schemas and server instructions load on every request but
	// are served by the server rather than stored in the repository, so they are named here and
	// counted inside the harness remainder — the granularity the data actually supports.
	mcp_servers: Array<string>
}

function to_row(source: string, text: string): ResidentRow {
	return {
		source,
		bytes: Buffer.byteLength(text, 'utf8'),
		tokens: cost_tokens.estimate(text),
		is_estimated: true,
	}
}

function read_directories(directory: string): Array<string> {
	try {
		return readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
	} catch {
		return []
	}
}

// What Claude Code lists for a skill is its name and description, which is the frontmatter block —
// the body is read only once a skill is invoked, so counting it would price an on-demand file as
// resident and report the split this package made as having achieved nothing.
function skills_index_text(root: string): string {
	const skill_root = path.join(root, skill_meta.SKILL_ROOT)

	return read_directories(skill_root)
		.map((name) =>
			skill_meta.frontmatter_of(
				file_reader.read_file_or_empty(path.join(skill_root, name, skill_meta.SKILL_ENTRY_FILE)),
			),
		)
		.join('\n')
}

// The whole `echo '…'` command rather than only what it echoes: this is the quantity
// `prompt-hook-brevity.test.ts` already caps, and the two must measure the same thing. The shell
// wrapper is a handful of bytes against a four-figure row.
function hooks_text(root: string): string {
	return prompt_hooks
		.user_prompt_hook_commands(file_reader.read_file_or_empty(path.join(root, SETTINGS_PATH)))
		.join('\n')
}

const SERVERS_KEY = 'mcpServers'

// Only the one level of keys is read. The entries themselves vary by transport — an http server
// carries a `url`, a stdio one a `command` with an `env` object under it — so nothing here types
// their values. Reading the names by pattern instead is what made that `env` block a second
// declared server in every consumer that runs a stdio server, and dropped any server whose name
// holds a character the pattern did not list.
function mcp_servers(root: string): Array<string> {
	const text = file_reader.read_file_or_empty(path.join(root, MCP_PATH))
	const parsed = json_value.parse_or_undefined(text)
	const servers = json_value.is_record(parsed) ? parsed[SERVERS_KEY] : undefined

	return json_value.is_record(servers) ? Object.keys(servers) : []
}

function local_rows(root: string): Array<ResidentRow> {
	return [
		to_row(CLAUDE_DOCUMENT, file_reader.read_file_or_empty(path.join(root, CLAUDE_DOCUMENT))),
		to_row(SKILLS_LABEL, skills_index_text(root)),
		to_row(HOOKS_LABEL, hooks_text(root)),
	]
}

// Never negative. An estimator that over-counted the local rows would otherwise print a negative
// harness, which reads as a defect in the transcript rather than in the estimate.
function harness_row(baseline_tokens: number, rows: ReadonlyArray<ResidentRow>): ResidentRow {
	const counted = rows.reduce((sum, row) => sum + row.tokens, 0)

	return {
		source: HARNESS_LABEL,
		bytes: 0,
		tokens: Math.max(0, baseline_tokens - counted),
		is_estimated: true,
	}
}

// The rows come from the working tree and the baseline from a session, and the two are the same
// point in time only for the newest session — which is the default. Reported for an older
// `--session <id>`, the sized rows describe today's documents against that session's baseline and
// the harness remainder absorbs the difference. Documented rather than corrected: the transcript
// does not carry the documents it was billed for, so there is nothing to read the older sizes from.
function build(root: string, baseline_tokens: number): ResidentBreakdown {
	const rows = local_rows(root)

	return {
		baseline_tokens,
		rows: [...rows, harness_row(baseline_tokens, rows)],
		mcp_servers: mcp_servers(root),
	}
}

const LABEL_WIDTH = 54
const BYTE_WIDTH = 11
const TOKEN_WIDTH = 9
const SHARE_WIDTH = 6
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1

function format_count(count: number): string {
	return count.toLocaleString('en-US')
}

function format_row(row: ResidentRow, baseline: number): string {
	const bytes = row.bytes === 0 ? '' : `${format_count(row.bytes)} B`
	const share =
		baseline === 0
			? 'n/a'
			: `${((row.tokens / baseline) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`

	return `  ${row.source.padEnd(LABEL_WIDTH)}${bytes.padStart(BYTE_WIDTH)}  ${format_count(row.tokens).padStart(TOKEN_WIDTH)}  ${share.padStart(SHARE_WIDTH)}`
}

// The clamp in `harness_row` keeps the remainder at 0 rather than printing a negative number, but a
// clamp that says nothing turns an over-count into a table whose shares quietly add past 100%.
// Saying so is the difference between a report and a wrong report.
function overrun_line(breakdown: ResidentBreakdown): Array<string> {
	const counted = breakdown.rows
		.filter((row) => row.source !== HARNESS_LABEL)
		.reduce((sum, row) => sum + row.tokens, 0)

	if (counted <= breakdown.baseline_tokens) return []

	return [
		`  ⚠ the rows above estimate ${format_count(counted)} tok against a measured baseline of`,
		`  ${format_count(breakdown.baseline_tokens)}; the harness row is clamped to 0 and the shares exceed 100%.`,
	]
}

function mcp_line(servers: ReadonlyArray<string>): Array<string> {
	if (servers.length === 0) return []

	return [
		`  MCP servers declared (${servers.join(', ')}) load their tool schemas and instructions`,
		'  on every request; both are served by the server, so they sit inside the harness row.',
	]
}

function format_resident(breakdown: ResidentBreakdown): Array<string> {
	return [
		`Resident breakdown (baseline ${format_count(breakdown.baseline_tokens)} tok, measured; rows estimated):`,
		...breakdown.rows.map((row) => format_row(row, breakdown.baseline_tokens)),
		...overrun_line(breakdown),
		...mcp_line(breakdown.mcp_servers),
	]
}

const cost_resident = {
	CLAUDE_DOCUMENT,
	HARNESS_LABEL,
	HOOKS_LABEL,
	SKILLS_LABEL,
	build,
	format_resident,
}

export type { ResidentBreakdown, ResidentRow }
export { cost_resident }
