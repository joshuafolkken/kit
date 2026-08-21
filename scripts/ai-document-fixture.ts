import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Several rules are distributed across the three paired AI docs plus the workflow prompt and the
// hook, and a rule that lands in only one of them leaves the AI with contradicting instructions.
// The marker suites that guard against that drift all need the same reader and the same paths, so
// they live here rather than being re-declared per suite.

const AI_DOCS: ReadonlyArray<string> = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']
const WORKFLOW_PROMPT = 'prompts/collaboration-workflow.md'
const CLAUDE_SETTINGS = '.claude/settings.json'
const ENV_EXAMPLE = '.env.example'

function read_repo_file(relative_path: string): string {
	return readFileSync(fileURLToPath(new URL(`../${relative_path}`, import.meta.url)), 'utf8')
}

export { AI_DOCS, CLAUDE_SETTINGS, ENV_EXAMPLE, read_repo_file, WORKFLOW_PROMPT }
