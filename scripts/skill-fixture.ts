import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Every skill this package distributes is asserted the same way — it ships as a directory, its entry
// file opens with frontmatter Claude Code can read, and that frontmatter carries the description
// other agents discover it by. The suites that check those properties would otherwise each re-declare
// the reader and the frontmatter pattern, and a second copy of a regex is a second thing to keep
// current (joshuafolkken/kit#854, which made the skill list longer than one).

const SKILL_ROOT = '.claude/skills'
const SKILL_ENTRY_FILE = 'SKILL.md'
const FRONTMATTER_PATTERN = /^---\n([\S\s]*?)\n---\n/u
const DESCRIPTION_PATTERN = /^description: (.+)$/mu

// Exported so `ai-document-fixture` reads repository files through the same base rather than
// re-deriving one; the import goes in this direction only, which keeps the two free of a cycle.
function package_file(relative_path: string): string {
	return fileURLToPath(new URL(`../${relative_path}`, import.meta.url))
}

function read_skill_file(skill_directory: string, filename: string = SKILL_ENTRY_FILE): string {
	return readFileSync(package_file(`${skill_directory}/${filename}`), 'utf8')
}

function has_frontmatter(content: string): boolean {
	return FRONTMATTER_PATTERN.test(content)
}

function skill_frontmatter(content: string): string {
	return FRONTMATTER_PATTERN.exec(content)?.[1] ?? ''
}

// The description is the trigger for every agent that discovers a skill by reading descriptions
// rather than by being told a path, so it is read out rather than merely asserted present.
function skill_description(content: string): string {
	return DESCRIPTION_PATTERN.exec(skill_frontmatter(content))?.[1] ?? ''
}

export {
	has_frontmatter,
	package_file,
	read_skill_file,
	skill_description,
	SKILL_ENTRY_FILE,
	SKILL_ROOT,
	skill_frontmatter,
}
