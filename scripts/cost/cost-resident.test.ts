import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cost_resident, type ResidentRow } from './cost-resident'
import { cost_tokens } from './cost-tokens'

const BASELINE_TOKENS = 50_000
const CLAUDE_BODY = 'rule text\n'.repeat(200)
const SKILL_BODY = ['---', 'name: demo', 'description: when to read it', '---', '', 'body'].join(
	'\n',
)
const HOOK_COMMAND = "echo 'remember the summary'"
const SETTINGS = JSON.stringify({
	hooks: {
		UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] }],
	},
})
const MCP = JSON.stringify({
	mcpServers: { svelte: { type: 'http', url: 'https://example.test' } },
})
const STDIO_MCP = JSON.stringify({
	mcpServers: { local: { command: 'run-it', env: { TOKEN: 'x' } } },
})

const state = { root: '' }

function write(relative_path: string, content: string): void {
	const full_path = path.join(state.root, relative_path)

	mkdirSync(path.dirname(full_path), { recursive: true })
	writeFileSync(full_path, content)
}

// Throws rather than falling back to the first row: a missing row is a defect in `build`, and
// silently reading another row's numbers would let every assertion below pass against the wrong row.
function row_named(rows: ReadonlyArray<ResidentRow>, source: string): ResidentRow {
	const row = rows.find((candidate) => candidate.source === source)

	if (row === undefined) throw new Error(`no resident row named ${source}`)

	return row
}

function populated(): ReturnType<typeof cost_resident.build> {
	write('CLAUDE.md', CLAUDE_BODY)
	write('.claude/skills/demo/SKILL.md', SKILL_BODY)
	write('.claude/settings.json', SETTINGS)
	write('.mcp.json', MCP)

	return cost_resident.build(state.root, BASELINE_TOKENS)
}

beforeEach(() => {
	state.root = mkdtempSync(path.join(tmpdir(), 'cost-resident-'))
})

afterEach(() => {
	state.root = ''
})

describe('build — the rows a repository can size', () => {
	it('sizes the resident document', () => {
		expect(row_named(populated().rows, cost_resident.CLAUDE_DOCUMENT)).toMatchObject({
			bytes: Buffer.byteLength(CLAUDE_BODY, 'utf8'),
			tokens: cost_tokens.estimate(CLAUDE_BODY),
		})
	})

	// The frontmatter only. Claude Code lists a skill by its name and description; the body is read
	// once the skill is invoked, so counting it would price an on-demand file as resident and report
	// the whole skill split as having achieved nothing.
	it('sizes the skills index from frontmatter rather than whole skill files', () => {
		const row = row_named(populated().rows, cost_resident.SKILLS_LABEL)

		expect(row.bytes).toBeGreaterThan(0)
		expect(row.bytes).toBeLessThan(Buffer.byteLength(SKILL_BODY, 'utf8'))
	})

	it('sizes the per-turn hook injection', () => {
		expect(row_named(populated().rows, cost_resident.HOOKS_LABEL)).toMatchObject({
			bytes: Buffer.byteLength(HOOK_COMMAND, 'utf8'),
		})
	})
})

describe('build — the remainder and what it contains', () => {
	// The whole point of the remainder: what the transcript cannot decompose is named rather than
	// distributed over the rows that could be measured.
	it('reports the rest of the measured baseline as one named harness row', () => {
		const breakdown = populated()
		const counted = breakdown.rows
			.filter((row) => row.source !== cost_resident.HARNESS_LABEL)
			.reduce((sum, row) => sum + row.tokens, 0)

		expect(row_named(breakdown.rows, cost_resident.HARNESS_LABEL).tokens).toBe(
			BASELINE_TOKENS - counted,
		)
	})

	it('names the MCP servers whose schemas sit inside that remainder', () => {
		expect(populated().mcp_servers).toStrictEqual(['svelte'])
	})

	// A stdio server nests an `env` object under its own entry, and reading the names by pattern
	// reported that block as a second declared server in every consumer that runs one.
	it('does not read a nested config block as another server', () => {
		write('.mcp.json', STDIO_MCP)

		expect(cost_resident.build(state.root, BASELINE_TOKENS).mcp_servers).toStrictEqual(['local'])
	})

	// The clamp keeps the remainder at 0; saying nothing about it would leave a table whose shares
	// quietly add past 100% looking like a measurement.
	it('says so when the estimated rows exceed the measured baseline', () => {
		write('CLAUDE.md', CLAUDE_BODY)

		const printed = cost_resident.format_resident(cost_resident.build(state.root, 1)).join('\n')

		expect(printed).toContain('the harness row is clamped to 0')
	})

	it('says in the heading which figure is measured and which are estimated', () => {
		expect(cost_resident.format_resident(populated())[0]).toContain('measured; rows estimated')
	})
})

describe('build — a project missing the artifacts', () => {
	it('reports empty rows rather than failing', () => {
		const breakdown = cost_resident.build(state.root, BASELINE_TOKENS)

		expect(row_named(breakdown.rows, cost_resident.CLAUDE_DOCUMENT).bytes).toBe(0)
		expect(breakdown.mcp_servers).toStrictEqual([])
	})

	// An estimator that over-counted would otherwise print a negative harness, which reads as a
	// defect in the transcript rather than in the estimate.
	it('never reports a negative harness', () => {
		write('CLAUDE.md', CLAUDE_BODY)

		const breakdown = cost_resident.build(state.root, 1)

		expect(row_named(breakdown.rows, cost_resident.HARNESS_LABEL).tokens).toBe(0)
	})

	it('omits the MCP note when no server is declared', () => {
		const printed = cost_resident.format_resident(cost_resident.build(state.root, BASELINE_TOKENS))

		expect(printed.join('\n')).not.toContain('MCP servers declared')
	})
})
