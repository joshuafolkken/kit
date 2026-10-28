import { describe, expect, it } from 'vitest'
import { sed_in_place } from './sed-in-place'

// joshuafolkken/kit#5284: a `sed -i` that `file-edits.md`'s countable conditions do not clear is
// refused. The file read is injected so the suite controls the match count.

function reads(text: string): () => string {
	return (): string => text
}

const ONCE = reads('const name = old_value\n')
const TWICE = reads('old_value\nold_value\n')
const NEVER = reads('nothing here\n')
const PLAIN_BSD = "sed -i '' 's/old_value/new_value/' a.ts"
const META_PATTERN = "sed -i '' 's/old.value/new/' a.ts"

describe('sed_in_place.is_unsafe_sed — refuses', () => {
	it('refuses a meta character in the pattern', () => {
		expect(sed_in_place.is_unsafe_sed(META_PATTERN, ONCE)).toBe(true)
	})

	it('refuses a meta character in the replacement', () => {
		expect(sed_in_place.is_unsafe_sed("sed -i 's/old_value/&_x/' a.ts", ONCE)).toBe(true)
	})

	it('refuses a pattern matching twice or never', () => {
		expect([
			sed_in_place.is_unsafe_sed(PLAIN_BSD, TWICE),
			sed_in_place.is_unsafe_sed(PLAIN_BSD, NEVER),
		]).toStrictEqual([true, true])
	})

	it('refuses a script that is not one s command', () => {
		expect([
			sed_in_place.is_unsafe_sed("sed -i '3d' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed -i -e 's/a/b/' -e 's/c/d/' a.ts", ONCE),
		]).toStrictEqual([true, true])
	})

	it('refuses in a chained segment', () => {
		expect(sed_in_place.is_unsafe_sed("cd x && sed -i.bak 's/old_value/new/' a.ts", TWICE)).toBe(
			true,
		)
	})
})

describe('sed_in_place.is_unsafe_sed — refuses a non-plain s command', () => {
	it('refuses an s flag other than g, which changes what or where sed writes', () => {
		expect([
			sed_in_place.is_unsafe_sed("sed -i '' 's/old_value/new_value/I' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed -i '' 's/old_value/new_value/w out' a.ts", ONCE),
		]).toStrictEqual([true, true])
	})

	it('refuses an extended regex, where the plain-text count is not what sed matches', () => {
		expect([
			sed_in_place.is_unsafe_sed("sed -E -i '' 's/old_value/new_value/' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed -Ei '' 's/old_value/new_value/' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed --regexp-extended -i 's/old_value/new_value/' a.ts", ONCE),
		]).toStrictEqual([true, true, true])
	})
})

describe('sed_in_place.is_unsafe_sed — stays silent', () => {
	it('lets a plain pattern matching once through, BSD and GNU spellings', () => {
		expect([
			sed_in_place.is_unsafe_sed(PLAIN_BSD, ONCE),
			sed_in_place.is_unsafe_sed("sed -i 's/old_value/new_value/' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed -i -e 's|old_value|new_value|' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed -i '' 's/old_value/new_value/g' a.ts", ONCE),
			sed_in_place.is_unsafe_sed("sed -ni '' 's/old_value/new_value/' a.ts", ONCE),
		]).toStrictEqual([false, false, false, false, false])
	})

	it('lets a sed that is not in place through', () => {
		expect(sed_in_place.is_unsafe_sed("sed -n '1,5p' a.ts", TWICE)).toBe(false)
	})
})

describe('sed_in_place — measurement', () => {
	it('reaches every in-place sed, kept by a plain one', () => {
		expect([
			sed_in_place.is_in_place_sed(PLAIN_BSD),
			sed_in_place.is_in_place_sed("sed -n '1p' a.ts"),
			sed_in_place.keeps_plain_sed(PLAIN_BSD),
			sed_in_place.keeps_plain_sed(META_PATTERN),
		]).toStrictEqual([true, false, true, false])
	})
})
