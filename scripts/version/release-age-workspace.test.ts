import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { release_age } from './release-age'

// `read_minimum_release_age` moved here from `latest-corepack` so `josh latest` and the version
// check read one policy rather than two copies of the same reader (joshuafolkken/kit#808).
const NO_QUARANTINE = 0
const WORKSPACE_NAME = 'pnpm-workspace.yaml'
const WORKSPACE_WITH_WINDOW = 'minimumReleaseAge: 1440\n'
const TEMP_PREFIX = 'release-age-'
const WORKSPACE_PACKAGES_ONLY = 'packages:\n  - .\n'
const DAY_MINUTES = 1440

// Each case makes its own directory and removes it, so no mutable module-level state is needed.
function with_workspace(
	content: string | undefined,
	read: (workspace_path: string) => number,
): number {
	const directory = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))
	const workspace_path = path.join(directory, WORKSPACE_NAME)

	try {
		if (content !== undefined) writeFileSync(workspace_path, content)

		return read(workspace_path)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

function age_of(content: string | undefined): number {
	return with_workspace(content, (workspace_path) =>
		release_age.read_minimum_release_age(workspace_path),
	)
}

describe('read_minimum_release_age', () => {
	it('reads the configured window', () => {
		expect(age_of(WORKSPACE_WITH_WINDOW)).toBe(DAY_MINUTES)
	})

	it('reads the window from among other settings', () => {
		expect(age_of(`${WORKSPACE_PACKAGES_ONLY}${WORKSPACE_WITH_WINDOW}`)).toBe(DAY_MINUTES)
	})

	it('is no quarantine when the setting is absent', () => {
		expect(age_of(WORKSPACE_PACKAGES_ONLY)).toBe(NO_QUARANTINE)
	})

	// An unreadable file means no quarantine, same as a missing setting: the policy is advisory and a
	// project without one must not be held back.
	it('is no quarantine when the file does not exist', () => {
		expect(age_of(undefined)).toBe(NO_QUARANTINE)
	})
})

// `josh version` runs from subdirectories and from outside a project, so the policy is resolved by
// walking up rather than from a fixed relative path (joshuafolkken/kit#808).
function with_project(read: (root: string) => number): number {
	const root = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

	try {
		writeFileSync(path.join(root, WORKSPACE_NAME), WORKSPACE_WITH_WINDOW)
		mkdirSync(path.join(root, 'scripts', 'version'), { recursive: true })

		return read(root)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// A nested workspace file below a root that declares the window, for the precedence cases.
function nearest_age_under_root(nested_content: string): number {
	const root = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

	try {
		writeFileSync(path.join(root, WORKSPACE_NAME), WORKSPACE_WITH_WINDOW)
		const nested = path.join(root, 'project')

		mkdirSync(nested, { recursive: true })
		writeFileSync(path.join(nested, WORKSPACE_NAME), nested_content)

		return release_age.read_nearest_minimum_release_age(nested, root)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

describe('read_nearest_minimum_release_age', () => {
	it('reads the window from the project root', () => {
		expect(with_project((root) => release_age.read_nearest_minimum_release_age(root))).toBe(
			DAY_MINUTES,
		)
	})

	it('reads the window from a nested subdirectory', () => {
		expect(
			with_project((root) =>
				release_age.read_nearest_minimum_release_age(path.join(root, 'scripts', 'version')),
			),
		).toBe(DAY_MINUTES)
	})

	// Outside any project the policy is absent, which means no quarantine rather than a failure. The
	// search is bounded to the temp root so the result cannot depend on the machine's own files.
	it('is no quarantine when no workspace file exists within the search boundary', () => {
		const empty = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}empty-`))

		try {
			expect(release_age.read_nearest_minimum_release_age(empty, empty)).toBe(NO_QUARANTINE)
		} finally {
			rmSync(empty, { recursive: true, force: true })
		}
	})

	it('looks past a nearer workspace file that does not declare the window', () => {
		expect(nearest_age_under_root(WORKSPACE_PACKAGES_ONLY)).toBe(DAY_MINUTES)
	})

	// A `.npmrc` beside the workspace file is inert under pnpm 12, so it must not stand in for it.
	it('ignores a legacy npmrc age line', () => {
		const empty = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}npmrc-`))

		try {
			writeFileSync(path.join(empty, '.npmrc'), 'minimum-release-age=1440\n')

			expect(release_age.read_nearest_minimum_release_age(empty, empty)).toBe(NO_QUARANTINE)
		} finally {
			rmSync(empty, { recursive: true, force: true })
		}
	})
})

// A declared `minimumReleaseAge: 0` is a deliberate opt-out, not an absent setting: it must stop the
// walk rather than let an ancestor's policy apply to a project that disabled it.
describe('read_nearest_minimum_release_age — an explicit zero opts out', () => {
	it('honours a nearer zero over an ancestor window', () => {
		expect(nearest_age_under_root('minimumReleaseAge: 0\n')).toBe(NO_QUARANTINE)
	})
})
