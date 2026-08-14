import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

// `josh init` / `josh sync` edit config files a consumer hand-authored. Reading them with a tolerant
// JSONC parse and writing the whole file back from the parsed object deleted every comment in them —
// silently, on a file the project never asked kit to rewrite. `sv create` ships a commented
// tsconfig.json, so this hit the ordinary SvelteKit case. See joshuafolkken/kit#798.
//
// One case per merge helper rather than one over the shared primitive: the defect was a helper
// writing the whole document back, so the guard belongs where that decision is made. A new helper
// that edits tsconfig.json or .vscode/*.json belongs in this list.

const HEADER_COMMENT = '// Do not edit this section — instead, edit svelte.config.js'
const NESTED_COMMENT = '// "checkJs": true — enable once the JS helpers are typed'
const KIT_PRESET = './node_modules/@joshuafolkken/kit/tsconfig/base.json'

const COMMENTED_TSCONFIG = `{
	"extends": ["./.svelte-kit/tsconfig.json"],
	"compilerOptions": {
		"strict": true,
		"noEmitOnError": false
		${NESTED_COMMENT}
	},
	${HEADER_COMMENT}
	"exclude": ["node_modules"]
}
`

const COMMENTED_SETTINGS = `{
	${HEADER_COMMENT}
	"editor.formatOnSave": true
}
`

// Built rather than written as a literal: VS Code setting ids are dotted, and the naming rule does
// not accept that shape as an object-literal key.
const VSCODE_ADDITION: Record<string, unknown> = Object.fromEntries([['eslint.enable', true]])

interface Merge {
	name: string
	source: string
	run: (content: string) => string
}

const MERGES: ReadonlyArray<Merge> = [
	{
		name: 'merge_json_extends',
		source: COMMENTED_TSCONFIG,
		run: (content) => init_logic_json_merge.merge_json_extends(content, KIT_PRESET),
	},
	{
		name: 'merge_json_array_field',
		source: COMMENTED_TSCONFIG,
		run: (content) => init_logic_json_merge.merge_json_array_field(content, 'exclude', ['build']),
	},
	{
		name: 'strip_redundant_compiler_options',
		source: COMMENTED_TSCONFIG,
		run: (content) =>
			init_logic_json_merge.strip_redundant_compiler_options(content, { strict: true }),
	},
	{
		name: 'merge_json_object',
		source: COMMENTED_SETTINGS,
		run: (content) => init_logic_json_merge.merge_json_object(content, VSCODE_ADDITION),
	},
]

describe('config merges preserve consumer comments (#798)', () => {
	// Without this a helper that silently no-oped would satisfy every case below by returning its
	// input, comments included, while proving nothing about the write path.
	it('starts from documents every merge actually rewrites', () => {
		const skipped = MERGES.filter((merge) => merge.run(merge.source) === merge.source)

		expect(skipped.map(({ name }) => name)).toStrictEqual([])
	})

	it.each(MERGES)('$name keeps the comment above the key it edits', ({ run, source }) => {
		expect(run(source)).toContain(HEADER_COMMENT)
	})

	it.each(MERGES)('$name still produces a readable document', ({ run, source }) => {
		expect(() => parse_jsonc(run(source))).not.toThrow()
	})
})

// strip_redundant_compiler_options is the one helper that DELETES a key rather than setting one, so
// the comment inside the block it removes goes with it while everything outside stays.
describe('strip_redundant_compiler_options — comment scope (#798)', () => {
	it('keeps an unrelated comment when it only prunes keys inside compilerOptions', () => {
		const result = init_logic_json_merge.strip_redundant_compiler_options(COMMENTED_TSCONFIG, {
			strict: true,
		})

		expect(result).toContain(HEADER_COMMENT)
		expect(result).toContain(NESTED_COMMENT)
		expect(parse_jsonc(result)).toStrictEqual({
			extends: ['./.svelte-kit/tsconfig.json'],
			compilerOptions: { noEmitOnError: false },
			exclude: ['node_modules'],
		})
	})

	it('drops the block comment along with the block when every option is redundant', () => {
		const result = init_logic_json_merge.strip_redundant_compiler_options(COMMENTED_TSCONFIG, {
			strict: true,
			noEmitOnError: false,
		})

		expect(result).toContain(HEADER_COMMENT)
		expect(result).not.toContain(NESTED_COMMENT)
		expect(parse_jsonc(result)).not.toHaveProperty('compilerOptions')
	})
})
