// Where a skill lives and how its frontmatter is read (joshuafolkken/kit#854, single-sourced for
// joshuafolkken/kit#1151).
//
// The suites that assert a skill ships correctly and the `josh cost` resident breakdown that sizes
// the skills index both need the same two facts: which directory holds the skills, and what the
// entry file's frontmatter says. This module is where those live, so the pattern is not written
// twice — `skill-fixture.ts` is a test fixture and is excluded from the published package, so
// shipped code cannot read it.

const SKILL_ROOT = '.claude/skills'
const SKILL_ENTRY_FILE = 'SKILL.md'
const FRONTMATTER_PATTERN = /^---\n([\S\s]*?)\n---\n/u
const DESCRIPTION_PATTERN = /^description: (.+)$/mu

function has_frontmatter(content: string): boolean {
	return FRONTMATTER_PATTERN.test(content)
}

function frontmatter_of(content: string): string {
	return FRONTMATTER_PATTERN.exec(content)?.[1] ?? ''
}

// The description is the trigger for every agent that discovers a skill by reading descriptions
// rather than by being told a path, so it is read out rather than merely asserted present.
function description_of(content: string): string {
	return DESCRIPTION_PATTERN.exec(frontmatter_of(content))?.[1] ?? ''
}

const skill_meta = {
	SKILL_ROOT,
	SKILL_ENTRY_FILE,
	has_frontmatter,
	frontmatter_of,
	description_of,
}

export { skill_meta }
