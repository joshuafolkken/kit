import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ancestor_directories } from './ancestor-directories'

const ROOT = path.parse(process.cwd()).root
const START = path.join(ROOT, 'a', 'b', 'c')

describe('ancestor_directories.list', () => {
	it('lists the start and every ancestor nearest-first, ending at the filesystem root', () => {
		expect(ancestor_directories.list(START)).toStrictEqual([
			START,
			path.join(ROOT, 'a', 'b'),
			path.join(ROOT, 'a'),
			ROOT,
		])
	})

	it('stops at once when the start is the filesystem root', () => {
		expect(ancestor_directories.list(ROOT)).toStrictEqual([ROOT])
	})

	it('resolves a relative start against the working directory', () => {
		expect(ancestor_directories.list('.')[0]).toBe(process.cwd())
	})
})

describe('ancestor_directories.nearest', () => {
	it('stops at the nearest directory the predicate accepts', () => {
		const visited: Array<string> = []
		const found = ancestor_directories.nearest(START, (directory) => {
			visited.push(directory)

			return directory === path.join(ROOT, 'a', 'b')
		})

		expect(found).toBe(path.join(ROOT, 'a', 'b'))
		expect(visited).toStrictEqual([START, path.join(ROOT, 'a', 'b')])
	})

	it('accepts the start directory itself', () => {
		expect(ancestor_directories.nearest(START, () => true)).toBe(START)
	})

	it('answers undefined when the walk reaches the root without a match', () => {
		expect(ancestor_directories.nearest(START, () => false)).toBeUndefined()
	})
})
