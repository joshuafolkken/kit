import { readdirSync, readFileSync } from 'node:fs'
import { package_file, SKILL_ROOT } from './skill-fixture'

// Several rules are distributed across the three paired AI docs plus the workflow prompt and the
// hook, and a rule that lands in only one of them leaves the AI with contradicting instructions.
// The marker suites that guard against that drift all need the same reader and the same paths, so
// they live here rather than being re-declared per suite.

const AI_DOCS: ReadonlyArray<string> = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']
const WORKFLOW_PROMPT = 'prompts/collaboration-workflow.md'
const CLAUDE_SETTINGS = '.claude/settings.json'
const ENV_EXAMPLE = '.env.example'
const MARKDOWN_EXTENSION = '.md'

function read_repo_file(relative_path: string): string {
	return readFileSync(package_file(relative_path), 'utf8')
}

// Every markdown file under the distributed skills, sorted so the concatenation below is stable
// whatever order the filesystem hands them back in.
function skill_documents(): ReadonlyArray<string> {
	const entries = readdirSync(package_file(SKILL_ROOT), { encoding: 'utf8', recursive: true })

	return entries
		.filter((entry) => entry.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => `${SKILL_ROOT}/${entry}`)
		.toSorted((left, right) => left.localeCompare(right))
}

// joshuafolkken/kit#854 moved the conditional rules — the workflow procedures, the post-update
// checks — out of the always-loaded documents and into the skills those documents route to. A rule
// still has to exist exactly once and reach every AI, but "where it is written" is now two places
// rather than one, so a marker suite reads the surface: the document plus EVERY distributed skill,
// not only the ones that document names. A suite reading the document alone would report the
// routing itself as the rule going missing.
//
// Taking every skill is the deliberate half of the trade. It keeps this list from being a second
// place to remember a skill, at the cost of coupling the negative assertions to skills they were
// not written about — a future skill that uses a retired phrase in prose fails a suite naming the
// AI documents. The message will point at the wrong file; the phrase it names is still the one to
// look for, and adding it here is one line.
//
// The per-document iteration is kept even though a skill-resident marker now reads the same for all
// three. It is not redundant in general: a rule that is still resident carries only that document's
// copy into its surface, so a marker dropped from GEMINI.md alone still fails on GEMINI.md alone.
function rule_surface_documents(document_path: string): ReadonlyArray<string> {
	return [document_path, ...skill_documents()]
}

function read_rule_surface(document_path: string): string {
	return rule_surface_documents(document_path)
		.map((path) => read_repo_file(path))
		.join('\n')
}

export {
	AI_DOCS,
	CLAUDE_SETTINGS,
	ENV_EXAMPLE,
	read_repo_file,
	read_rule_surface,
	rule_surface_documents,
	skill_documents,
	WORKFLOW_PROMPT,
}
