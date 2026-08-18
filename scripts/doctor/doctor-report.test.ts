import { gh_spawn } from '#scripts/gh-spawn'
import { security_updates } from '#scripts/security-updates'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { doctor } from './doctor'
import { doctor_io, type GitTopLevel } from './doctor-io'

// A source-text guard proves the call was written, not that it runs. `josh doctor` is the diagnostic
// a user reaches for when npm advisories are not arriving, so this drives `main` and asserts the
// report actually executes — an early return or a conditional that skipped it would fail here while
// leaving the text guard green (joshuafolkken/kit#805).
const JOSH_PATH = '/Users/example/Library/pnpm/bin/josh'
const REPO = 'joshuafolkken/kit'
const TOP_LEVEL = '/Users/example/project'
const INSIDE: GitTopLevel = { state: 'inside', top_level: TOP_LEVEL }

beforeEach(() => {
	vi.resetAllMocks()
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(doctor_io, 'resolve_path_josh').mockReturnValue(JOSH_PATH)
	vi.spyOn(doctor_io, 'resolve_pnpm_global_josh').mockReturnValue(JOSH_PATH)
	vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(INSIDE)
	// The gate is the distributed `.github/dependabot.yml`; present unless a case says otherwise.
	vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(true)
	// The repository name is resolved as the report's argument, so it is evaluated even when the
	// report itself is stubbed — without this the suite would spawn a real `gh repo view`.
	vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue(REPO)
})

describe('josh doctor', () => {
	it('reports the Dependabot security-updates setting', () => {
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(report).toHaveBeenCalledTimes(1)
	})

	// The network call runs last so an unreachable `gh` cannot hold up the local diagnosis, which is
	// the part a user with a broken install actually needs.
	it('completes the PATH diagnosis before the network check', () => {
		const order: Array<string> = []

		vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
			if (typeof line === 'string' && line.includes('PATH shadowing')) order.push('path')
		})
		vi.spyOn(security_updates, 'report_security_updates_section').mockImplementation(() => {
			order.push('network')

			return 'enabled'
		})

		doctor.main()

		expect(order).toStrictEqual(['path', 'network'])
	})
})

// `doctor` diagnoses the global install and is routinely run from a home directory or from a clone
// of an unrelated project. Applicability is decided locally so it does not depend on `gh` working.
describe('josh doctor — where the report applies', () => {
	// A repository that never received the distributed `.github/dependabot.yml` has no such
	// prerequisite, and an enabling command aimed at it would target someone else's repository.
	it('resolves the config from the repository root, not the working directory', () => {
		const has_config = vi
			.spyOn(doctor_io, 'has_distributed_dependabot_config')
			.mockReturnValue(true)

		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')

		doctor.main()

		// Bounded to the repository root, so a nested repository does not inherit a parent's config.
		expect(has_config).toHaveBeenCalledWith(TOP_LEVEL, TOP_LEVEL)
	})

	// An undetermined root must still be gated, or a missing `git` would warn about a nonexistent
	// repository from a home directory.
	it('still applies the config gate when git cannot answer', () => {
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue({ state: 'undetermined' })
		vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(false)
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(report).not.toHaveBeenCalled()
	})

	it('skips the report when the distributed dependabot config is absent', () => {
		vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(false)
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(report).not.toHaveBeenCalled()
	})
})

describe('josh doctor — when the answer is undetermined', () => {
	it('skips the report when git proves there is no repository', () => {
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue({ state: 'outside' })
		// Stubbed rather than left to call through: without an implementation a regression of the
		// guard would spawn a live `gh api` from the unit suite instead of failing cleanly.
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(report).not.toHaveBeenCalled()
	})

	// The counterpart to the skip: a missing or failing `git` must leave the check running, because
	// an undetermined answer reported as silence is the false all-clear the feature exists to remove.
	it('still reports when git cannot answer but the config is present', () => {
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue({ state: 'undetermined' })
		// The gate is the distributed `.github/dependabot.yml`; present unless a case says otherwise.
		vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(true)
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('unreadable')

		doctor.main()

		expect(report).toHaveBeenCalledTimes(1)
	})

	// The counterpart: inside a repository a failed lookup must surface as `could not be read`, not
	// as silence — silence is the false all-clear joshuafolkken/kit#805 exists to remove.
	it('still reports inside a work tree when the repository lookup fails', () => {
		vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue(undefined)
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('unreadable')

		doctor.main()

		expect(report).toHaveBeenCalledWith(undefined)
	})

	it('still reports the setting when the PATH josh is shadowed', () => {
		vi.spyOn(doctor_io, 'resolve_path_josh').mockReturnValue('/usr/local/bin/josh')
		const report = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('disabled')

		doctor.main()

		expect(report).toHaveBeenCalledTimes(1)
	})
})

describe('josh doctor — bounded lookup', () => {
	// `doctor` writes nothing, so the repository lookup must return promptly; the unbounded variant
	// would defeat the timeout on the query that follows it (joshuafolkken/kit#805).
	it('uses the bounded repository lookup, never the unbounded one', () => {
		const bounded = vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue(REPO)
		const unbounded = vi.spyOn(gh_spawn, 'get_repo_name_with_owner')

		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')

		doctor.main()

		expect(bounded).toHaveBeenCalledTimes(1)
		expect(unbounded).not.toHaveBeenCalled()
	})
})
