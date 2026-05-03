import { describe, expect, it } from 'vitest'
import { install_bin_logic } from './install-bin-logic'

const HOME = '/home/testuser'
const PKG_DIR = '/home/testuser/dev/config'
const CONSUMER_DIR = '/home/testuser/my-project'
const BIN_DIRECTORY_PATH = '/home/testuser/.local/bin'
const JOSH_BIN_PATH = '/home/testuser/.local/bin/josh'
const TSX_PATH = '/home/testuser/my-project/node_modules/.bin/tsx'
const JOSH_SCRIPT_PATH = '/home/testuser/dev/config/scripts/josh.ts'

describe('install_bin_logic.resolve_local_bin_directory', () => {
	it('returns .local/bin under home directory', () => {
		expect(install_bin_logic.resolve_local_bin_directory(HOME)).toBe(BIN_DIRECTORY_PATH)
	})
})

describe('install_bin_logic.resolve_bin_path', () => {
	it('returns josh bin path under local bin directory', () => {
		expect(install_bin_logic.resolve_bin_path(HOME)).toBe(JOSH_BIN_PATH)
	})
})

describe('install_bin_logic.resolve_tsx_path', () => {
	it('returns node_modules/.bin/tsx under cwd', () => {
		expect(install_bin_logic.resolve_tsx_path(CONSUMER_DIR)).toBe(TSX_PATH)
	})
})

describe('install_bin_logic.resolve_josh_script_path', () => {
	it('returns scripts/josh.ts under package directory', () => {
		expect(install_bin_logic.resolve_josh_script_path(PKG_DIR)).toBe(JOSH_SCRIPT_PATH)
	})
})

const DOUBLE_QUOTE_ERROR = 'double-quotes'

describe('install_bin_logic.generate_wrapper_script', () => {
	it('includes shebang, tsx path, and josh script path', () => {
		const script = install_bin_logic.generate_wrapper_script(TSX_PATH, JOSH_SCRIPT_PATH)

		expect(script).toContain('#!/bin/sh')
		expect(script).toContain(TSX_PATH)
		expect(script).toContain(JOSH_SCRIPT_PATH)
	})

	it('throws when tsx_path contains a double-quote', () => {
		expect(() => install_bin_logic.generate_wrapper_script('path/"tsx', JOSH_SCRIPT_PATH)).toThrow(
			DOUBLE_QUOTE_ERROR,
		)
	})

	it('throws when josh_script_path contains a double-quote', () => {
		expect(() => install_bin_logic.generate_wrapper_script(TSX_PATH, 'path/"josh.ts')).toThrow(
			DOUBLE_QUOTE_ERROR,
		)
	})
})

describe('install_bin_logic.is_dependency_install', () => {
	it('returns false when INIT_CWD is empty (direct invocation)', () => {
		expect(install_bin_logic.is_dependency_install(PKG_DIR, '')).toBe(false)
	})

	it('returns false when INIT_CWD matches package directory (root install)', () => {
		expect(install_bin_logic.is_dependency_install(PKG_DIR, PKG_DIR)).toBe(false)
	})

	it('returns true when INIT_CWD differs from package directory (dependency install)', () => {
		expect(install_bin_logic.is_dependency_install(PKG_DIR, CONSUMER_DIR)).toBe(true)
	})
})

describe('install_bin_logic.is_bin_directory_on_path', () => {
	it('returns true when bin_directory is on PATH', () => {
		expect(
			install_bin_logic.is_bin_directory_on_path(
				BIN_DIRECTORY_PATH,
				`/usr/bin:${BIN_DIRECTORY_PATH}:/usr/local/bin`,
			),
		).toBe(true)
	})

	it('returns false when bin_directory is not on PATH', () => {
		expect(
			install_bin_logic.is_bin_directory_on_path(BIN_DIRECTORY_PATH, '/usr/bin:/usr/local/bin'),
		).toBe(false)
	})
})

describe('install_bin_logic.format_success', () => {
	it('includes the installed bin path', () => {
		expect(install_bin_logic.format_success(JOSH_BIN_PATH)).toContain(JOSH_BIN_PATH)
	})
})

describe('install_bin_logic.format_path_hint', () => {
	it('includes the bin directory in the export hint', () => {
		expect(install_bin_logic.format_path_hint(BIN_DIRECTORY_PATH)).toContain(BIN_DIRECTORY_PATH)
	})
})

describe('install_bin_logic.format_skip', () => {
	it('mentions dependency install', () => {
		expect(install_bin_logic.format_skip()).toContain('dependency')
	})
})
