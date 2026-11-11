import { describe, expect, it } from 'vitest'
import { path_glob } from './path-glob'

const RUST_SOURCES = 'src/**/*.rs'
const CRATE = 'crates/core'
const MANIFEST = 'Cargo.toml'

describe('path_glob.matches', () => {
	it.each([
		['a glob', 'src/lib/parse.rs', RUST_SOURCES, true],
		['a bare directory, over a file under it', `${CRATE}/src/lib.rs`, CRATE, true],
		['an exact file', MANIFEST, MANIFEST, true],
		['a glob, over a path outside it', 'docs/guide.md', RUST_SOURCES, false],
		['a bare directory, over a sibling sharing its prefix', `${CRATE}-x/a.rs`, CRATE, false],
	])('answers %s', (_case, file, pattern, expected) => {
		expect(path_glob.matches(file, pattern)).toBe(expected)
	})
})
