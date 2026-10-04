import { describe, expect, it } from 'vitest'
import { distributed_paths } from './distributed-paths'

const KIT_PREFIX = 'node_modules/@joshuafolkken/kit/'
const BLOB_BASE = 'https://github.com/joshuafolkken/kit/blob/main/'
const TREE_BASE = 'https://github.com/joshuafolkken/kit/tree/main/'
const IMPORT_LINE = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.md'
const OLD_BOOTSTRAP =
	'> Fresh checkout: if kit is not installed, run `pnpm install` first, then reread this file before doing any other work.'
const BOOTSTRAP_START = '> Fresh checkout: before `pnpm install`'
const LOCAL_SECTION = '# Local\n'

function bootstrap_line(content: string): string {
	return content.split('\n', 1)[0] ?? ''
}

const BOOTSTRAP = bootstrap_line(distributed_paths.ensure_claude_md_import(undefined))

function count(content: string, needle: string): number {
	return content.split(needle).length - 1
}

describe('distributed_paths.transform_prompt_paths', () => {
	it('rewrites backtick prompt references and skips globs and bare text', () => {
		expect(
			distributed_paths.transform_prompt_paths('`prompts/a.md` `prompts/**` prompts/x.md'),
		).toBe(`\`${KIT_PREFIX}prompts/a.md\` \`prompts/**\` prompts/x.md`)
	})
})

describe('distributed_paths.transform_distributed_paths', () => {
	it('rewrites bundled paths into node_modules', () => {
		expect(
			distributed_paths.transform_distributed_paths('`prompts/a.md` `eslint/rules/x.js`'),
		).toBe(`\`${KIT_PREFIX}prompts/a.md\` \`${KIT_PREFIX}eslint/rules/x.js\``)
	})

	it('rewrites test files and docs paths to GitHub URLs', () => {
		expect(
			distributed_paths.transform_distributed_paths(
				'`scripts/a.test.ts` `b/c.spec.ts` `docs/` `docs/x.md`',
			),
		).toBe(
			`\`${BLOB_BASE}scripts/a.test.ts\` \`${BLOB_BASE}b/c.spec.ts\` \`${TREE_BASE}docs/\` \`${BLOB_BASE}docs/x.md\``,
		)
	})

	it('leaves globs and unrelated paths untouched', () => {
		const content = '`eslint/**` `docs/**` `other/x.ts`'

		expect(distributed_paths.transform_distributed_paths(content)).toBe(content)
	})

	// Pins current behavior: a test file under prompts/ is rewritten twice into a GitHub URL that
	// embeds the node_modules path.
	it('rewrites a prompts test file to a GitHub URL containing the node_modules path', () => {
		expect(distributed_paths.transform_distributed_paths('`prompts/x.test.ts`')).toBe(
			`\`${BLOB_BASE}${KIT_PREFIX}prompts/x.test.ts\``,
		)
	})
})

describe('distributed_paths.ensure_claude_md_import', () => {
	it('writes the bootstrap note and import line for a new file', () => {
		expect(BOOTSTRAP.startsWith(BOOTSTRAP_START)).toBe(true)
		expect(distributed_paths.ensure_claude_md_import(undefined)).toBe(
			`${BOOTSTRAP}\n\n${IMPORT_LINE}\n`,
		)
	})

	it('prepends bootstrap and import ahead of existing project content', () => {
		expect(distributed_paths.ensure_claude_md_import(LOCAL_SECTION)).toBe(
			`${BOOTSTRAP}\n\n${IMPORT_LINE}\n\n${LOCAL_SECTION}`,
		)
	})

	it('upgrades the old bootstrap note in place without duplicating the import', () => {
		expect(distributed_paths.ensure_claude_md_import(`${OLD_BOOTSTRAP}\n\n${IMPORT_LINE}\n`)).toBe(
			`${BOOTSTRAP}\n\n${IMPORT_LINE}\n`,
		)
	})

	it('adds only the bootstrap note when the import line is already present', () => {
		const existing = `${IMPORT_LINE}\n${LOCAL_SECTION}`

		expect(distributed_paths.ensure_claude_md_import(existing)).toBe(`${BOOTSTRAP}\n\n${existing}`)
	})

	it('is idempotent on its own output', () => {
		const once = distributed_paths.ensure_claude_md_import(LOCAL_SECTION)

		expect(distributed_paths.ensure_claude_md_import(once)).toBe(once)
	})

	// Pins current behavior: a bootstrap note without the import line gets a second bootstrap note.
	it('duplicates the bootstrap note when the file has a bootstrap but no import line', () => {
		const result = distributed_paths.ensure_claude_md_import(`${OLD_BOOTSTRAP}\n${LOCAL_SECTION}`)

		expect(count(result, BOOTSTRAP)).toBe(['first', 'second'].length)
	})
})

describe('distributed_paths.remove_claude_md_import', () => {
	it('removes written lines and their trailing blank lines, keeping project content', () => {
		const written = distributed_paths.ensure_claude_md_import(LOCAL_SECTION)

		expect(distributed_paths.remove_claude_md_import(written)).toBe(LOCAL_SECTION)
	})

	it('removes the old bootstrap note as well', () => {
		const content = `${OLD_BOOTSTRAP}\n\n${IMPORT_LINE}\n\n${LOCAL_SECTION}`

		expect(distributed_paths.remove_claude_md_import(content)).toBe(LOCAL_SECTION)
	})

	it('empties a file that only holds the written lines', () => {
		const written = distributed_paths.ensure_claude_md_import(undefined)

		expect(distributed_paths.remove_claude_md_import(written)).toBe('')
	})

	it('keeps blank lines that do not follow a written line', () => {
		expect(distributed_paths.remove_claude_md_import('a\n\nb\n')).toBe('a\n\nb\n')
	})

	it('exposes the import line constant', () => {
		expect(distributed_paths.CLAUDE_MD_IMPORT_LINE).toBe(IMPORT_LINE)
	})
})
