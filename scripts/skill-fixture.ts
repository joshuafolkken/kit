import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { skill_meta } from './skill-meta'

// Every skill this package distributes is asserted the same way — it ships as a directory, its entry
// file opens with frontmatter Claude Code can read, and that frontmatter carries the description
// other agents discover it by. The suites that check those properties would otherwise each re-declare
// the reader and the frontmatter pattern, and a second copy of a regex is a second thing to keep
// current (joshuafolkken/kit#854, which made the skill list longer than one).
//
// The pattern itself moved to `skill-meta.ts` for joshuafolkken/kit#1151: `josh cost` sizes the
// skills index from the same frontmatter, and shipped code cannot import a fixture. What stays here
// is the file access these suites need and the names they already import.

const { SKILL_ROOT, SKILL_ENTRY_FILE } = skill_meta

// Exported so `ai-document-fixture` reads repository files through the same base rather than
// re-deriving one; the import goes in this direction only, which keeps the two free of a cycle.
function package_file(relative_path: string): string {
	return fileURLToPath(new URL(`../${relative_path}`, import.meta.url))
}

function read_skill_file(skill_directory: string, filename: string = SKILL_ENTRY_FILE): string {
	return readFileSync(package_file(`${skill_directory}/${filename}`), 'utf8')
}

function has_frontmatter(content: string): boolean {
	return skill_meta.has_frontmatter(content)
}

function skill_frontmatter(content: string): string {
	return skill_meta.frontmatter_of(content)
}

function skill_description(content: string): string {
	return skill_meta.description_of(content)
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
