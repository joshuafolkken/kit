import { describe, expect, it } from 'vitest'
import { shell_redirects } from './shell-redirects'

describe('shell_redirects.targets_of', () => {
	it.each([
		['cat < in.txt', ['in.txt']],
		['echo x > out.txt', ['out.txt']],
		['echo x >> out.txt 2> err.txt', ['out.txt', 'err.txt']],
		['echo x >| out.txt', ['out.txt']],
	])('reads the files %j names', (segment, expected) => {
		expect(shell_redirects.targets_of(segment, 'echo')).toEqual(expected)
	})

	it('takes a quoted `>` for text', () => {
		expect(shell_redirects.targets_of('echo "a > b.txt"', 'echo')).toEqual([])
	})

	// The closing quote stays on the word; a caller's path test reads past it.
	it("reads a shell's quoted script as written", () => {
		expect(shell_redirects.targets_of('sh -c "echo x > b.txt"', 'sh')).toEqual(['b.txt"'])
	})
})

describe('shell_redirects.targets_of combined redirects', () => {
	it('keeps both the read and written files (ac-6ec7da1e)', () => {
		expect(shell_redirects.targets_of('sort < in.txt > out.txt', 'sort')).toEqual([
			'in.txt',
			'out.txt',
		])
	})

	it('reads `&>` as a write', () => {
		expect(shell_redirects.targets_of('make &> log.txt', 'make')).toEqual(['log.txt'])
	})
})
