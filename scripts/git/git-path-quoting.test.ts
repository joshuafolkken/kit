import { describe, expect, it } from 'vitest'
import { git_path_quoting } from './git-path-quoting'

const PLAIN = 'plain-日本語.ts'

describe('Git path quoting with core.quotePath=false', () => {
	it.each([
		[PLAIN, PLAIN],
		['tab\tname.ts', '"tab\\tname.ts"'],
		['quote".ts', '"quote\\".ts"'],
		['back\\slash.ts', '"back\\\\slash.ts"'],
		['line\nname.ts', '"line\\nname.ts"'],
		['control\u{1}.ts', '"control\\001.ts"'],
		['bell\u{7}.ts', '"bell\\a.ts"'],
		['vertical\v.ts', '"vertical\\v.ts"'],
	])('encodes and decodes %j', (file, quoted) => {
		expect(git_path_quoting.quote(file)).toBe(quoted)
		expect(git_path_quoting.unquote(quoted)).toBe(file)
	})
})
