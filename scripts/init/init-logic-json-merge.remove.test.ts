import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

const POSTINSTALL_KEY = 'postinstall'
const MARKER = 'fix-gh-packages'
const LEFTHOOK_CMD = 'lefthook install'
const FIX_GH_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'

describe('init_logic_json_merge.remove_script_with_marker', () => {
	it('removes the script when its value contains the marker', () => {
		const content = JSON.stringify({
			scripts: { [POSTINSTALL_KEY]: `${LEFTHOOK_CMD} && ${FIX_GH_CMD}`, build: 'tsc' },
		})
		const result = JSON.parse(
			init_logic_json_merge.remove_script_with_marker(content, POSTINSTALL_KEY, MARKER),
		) as { scripts: Record<string, string> }

		expect(result.scripts).not.toHaveProperty(POSTINSTALL_KEY)
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
		expect(result.scripts['build']).toBe('tsc')
	})

	it('returns content unchanged when the script lacks the marker', () => {
		const content = JSON.stringify({ scripts: { [POSTINSTALL_KEY]: LEFTHOOK_CMD } })

		expect(init_logic_json_merge.remove_script_with_marker(content, POSTINSTALL_KEY, MARKER)).toBe(
			content,
		)
	})

	it('returns content unchanged when the key is absent', () => {
		const content = JSON.stringify({ scripts: { build: 'tsc' } })

		expect(init_logic_json_merge.remove_script_with_marker(content, POSTINSTALL_KEY, MARKER)).toBe(
			content,
		)
	})

	it('returns content unchanged when the scripts block is absent', () => {
		expect(init_logic_json_merge.remove_script_with_marker('{}', POSTINSTALL_KEY, MARKER)).toBe(
			'{}',
		)
	})
})

const BUILD_KEY = 'build'
const WRANGLER_TYPES_PATTERN = /^wrangler types(?:\s|$)/u
const VITE_BUILD = 'vite build && pnpm run prepack'
const VITE_BUILD_ONLY = 'vite build'

function remove_segment(content: string): string {
	return init_logic_json_merge.remove_script_command_segment(
		content,
		BUILD_KEY,
		WRANGLER_TYPES_PATTERN,
	)
}

function build_after_removal(build: string): string | undefined {
	const content = JSON.stringify({ scripts: { [BUILD_KEY]: build } })
	const result = JSON.parse(remove_segment(content)) as { scripts: Record<string, string> }

	// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
	return result.scripts['build']
}

function build_content(build: string): string {
	return JSON.stringify({ scripts: { [BUILD_KEY]: build } })
}

describe('init_logic_json_merge.remove_script_command_segment', () => {
	it('removes a leading wrangler types segment from build', () => {
		expect(build_after_removal(`wrangler types && ${VITE_BUILD}`)).toBe(VITE_BUILD)
	})

	it('removes a trailing wrangler types segment from build', () => {
		expect(build_after_removal(`${VITE_BUILD_ONLY} && wrangler types`)).toBe(VITE_BUILD_ONLY)
	})

	it('removes a wrangler types segment that carries flags', () => {
		expect(build_after_removal(`wrangler types --env production && ${VITE_BUILD_ONLY}`)).toBe(
			VITE_BUILD_ONLY,
		)
	})

	it('leaves a build that does not run wrangler types untouched', () => {
		const content = build_content(VITE_BUILD)

		expect(remove_segment(content)).toBe(content)
	})

	it('does not match an unrelated command that merely mentions the words', () => {
		const content = build_content(`echo wrangler types && ${VITE_BUILD_ONLY}`)

		expect(remove_segment(content)).toBe(content)
	})

	it('is unchanged when the build key is absent', () => {
		const content = JSON.stringify({ scripts: { lint: 'eslint' } })

		expect(remove_segment(content)).toBe(content)
	})

	it('is unchanged when the scripts block is absent for segment removal', () => {
		expect(remove_segment('{}')).toBe('{}')
	})
})
