import { auto_merge_setting } from '#scripts/auto-merge-setting'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { gh_spawn } from '#scripts/gh-spawn'
import { security_updates } from '#scripts/security-updates'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { doctor } from './doctor'
import { doctor_io, type GitTopLevel } from './doctor-io'
import { doctor_logic } from './doctor-logic'

// A source-text guard proves the call was written, not that it runs. `josh doctor` is the diagnostic
// a user reaches for when npm advisories are not arriving, so this drives `main` and asserts the
// report actually executes — an early return or a conditional that skipped it would fail here while
// leaving the text guard green (joshuafolkken/kit#805).
const JOSH_PATH = '/Users/example/Library/pnpm/bin/josh'
const REPO = 'joshuafolkken/kit'
const TOP_LEVEL = '/Users/example/project'
const INSIDE: GitTopLevel = { state: 'inside', top_level: TOP_LEVEL }
const OUTSIDE: GitTopLevel = { state: 'outside' }
const UNDETERMINED: GitTopLevel = { state: 'undetermined' }
const DISCOVER = 'discover_repositories'
const APP_KIT_KEY = 'joshuafolkken/app-kit'

// The IO the report reads from, all stubbed: `doctor` otherwise spawns `which`, `pnpm bin -g` and
// `git` from the unit suite, and scans the real parent directory of the checkout it runs in.
function stub_doctor_io(): void {
	vi.spyOn(doctor_io, 'resolve_path_josh').mockReturnValue(JOSH_PATH)
	vi.spyOn(doctor_io, 'resolve_pnpm_global_josh').mockReturnValue(JOSH_PATH)
	vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(INSIDE)
	// The gate is the distributed `.github/dependabot.yml`; present unless a case says otherwise.
	vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(true)
	// The second gate, joshuafolkken/kit#834's distributed auto-merge workflow. Stubbed absent by
	// default so the pre-existing cases keep asserting the Dependabot report alone; the cases that
	// care about it turn it on.
	vi.spyOn(doctor_io, 'has_auto_merge_workflow').mockReturnValue(false)
	// Stubbed rather than left to call through: without this the suite would scan the real parent
	// directory of the checkout it runs in, making the result depend on the machine.
	vi.spyOn(repo_discovery, 'discover_repositories').mockReturnValue(new Map())
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	stub_doctor_io()
	// Stubbed rather than left to call through: a regression of a gate would otherwise spawn a live
	// `gh api` from the unit suite instead of failing cleanly.
	vi.spyOn(auto_merge_setting, 'report_auto_merge_section').mockReturnValue('enabled')
	// The same reason, for the other report — and here it was not a hypothetical regression: the four
	// cases that drive `doctor.main()` without naming this report spawned a live
	// `gh api …/automated-security-fixes` on every run (joshuafolkken/kit#1353). A case that asserts
	// on the report spies again and reads its own spy, exactly as the auto-merge one above does.
	vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')
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
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(UNDETERMINED)
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
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(OUTSIDE)
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
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(UNDETERMINED)
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

// joshuafolkken/kit#834: the auto-merge workflow `josh sync` now distributes runs `gh pr merge
// --auto`, which fails outright unless the repository allows auto-merge. `doctor` is where a user
// goes to ask why a green Dependabot pull request is not merging, so the report has to run there —
// and only where the workflow that needs it actually exists.
describe('josh doctor — repository auto-merge setting', () => {
	it('reports the setting when the auto-merge workflow is present', () => {
		vi.spyOn(doctor_io, 'has_auto_merge_workflow').mockReturnValue(true)
		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')
		const report = vi
			.spyOn(auto_merge_setting, 'report_auto_merge_section')
			.mockReturnValue('disabled')

		doctor.main()

		expect(report).toHaveBeenCalledWith(REPO)
	})

	// Without the workflow there is no prerequisite, and an enabling command would target a
	// repository that never asked for auto-merge.
	it('skips the report when no auto-merge workflow is present', () => {
		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')
		const report = vi
			.spyOn(auto_merge_setting, 'report_auto_merge_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(report).not.toHaveBeenCalled()
	})

	// The gates are independent: a consumer synced before #834 has the Dependabot config and no
	// auto-merge workflow, and a repository that only ever added its own auto-merge workflow has the
	// second prerequisite without the first.
	it('reports the auto-merge setting even when the dependabot config is absent', () => {
		vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(false)
		vi.spyOn(doctor_io, 'has_auto_merge_workflow').mockReturnValue(true)
		const security = vi
			.spyOn(security_updates, 'report_security_updates_section')
			.mockReturnValue('enabled')
		const report = vi
			.spyOn(auto_merge_setting, 'report_auto_merge_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(security).not.toHaveBeenCalled()
		expect(report).toHaveBeenCalledTimes(1)
	})
})

describe('josh doctor — where the auto-merge report applies', () => {
	it('bounds the gate to the repository root, so a nested repository inherits nothing', () => {
		const has_workflow = vi.spyOn(doctor_io, 'has_auto_merge_workflow').mockReturnValue(true)

		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')
		doctor.main()

		expect(has_workflow).toHaveBeenCalledWith(TOP_LEVEL, TOP_LEVEL)
	})

	it('skips the auto-merge report when git proves there is no repository', () => {
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(OUTSIDE)
		vi.spyOn(doctor_io, 'has_auto_merge_workflow').mockReturnValue(true)
		const report = vi
			.spyOn(auto_merge_setting, 'report_auto_merge_section')
			.mockReturnValue('enabled')

		doctor.main()

		expect(report).not.toHaveBeenCalled()
	})
})

// The repository name costs a `gh repo view` round trip. It is resolved once for both reports, and
// not at all when neither prerequisite exists.
describe('josh doctor — one repository lookup for both reports', () => {
	it('resolves the repository once when both reports apply', () => {
		vi.spyOn(doctor_io, 'has_auto_merge_workflow').mockReturnValue(true)
		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')
		const resolve = vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue(REPO)

		doctor.main()

		expect(resolve).toHaveBeenCalledTimes(1)
	})

	it('never spawns the lookup when neither prerequisite is present', () => {
		vi.spyOn(doctor_io, 'has_distributed_dependabot_config').mockReturnValue(false)
		const resolve = vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue(REPO)

		vi.spyOn(security_updates, 'report_security_updates_section').mockReturnValue('enabled')
		doctor.main()

		expect(resolve).not.toHaveBeenCalled()
	})
})

describe('josh doctor — the discovered repository map', () => {
	it('prints the map for the repository it is standing in', () => {
		const discover = vi
			.spyOn(repo_discovery, DISCOVER)
			.mockReturnValue(new Map([[APP_KIT_KEY, '/Users/example/app-kit']]))
		const info = vi.spyOn(console, 'info')

		doctor.main()

		expect(discover).toHaveBeenCalledWith(TOP_LEVEL)
		expect(info.mock.calls.flat().join('\n')).toContain(APP_KIT_KEY)
	})

	it('says so rather than staying silent when nothing was discovered', () => {
		vi.spyOn(repo_discovery, DISCOVER).mockReturnValue(new Map())
		const info = vi.spyOn(console, 'info')

		doctor.main()

		expect(info.mock.calls.flat().join('\n')).toContain(doctor_logic.NO_REPOSITORIES_FOUND)
	})

	it('prints no map from outside a repository, where there is no owner to anchor it', () => {
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(OUTSIDE)
		const discover = vi.spyOn(repo_discovery, DISCOVER)
		const info = vi.spyOn(console, 'info')

		doctor.main()

		expect(discover).not.toHaveBeenCalled()
		expect(info.mock.calls.flat().join('\n')).not.toContain(doctor_logic.REPOSITORY_MAP_HEADING)
	})

	it('prints no map when git could not tell where the repository is', () => {
		vi.spyOn(doctor_io, 'resolve_git_top_level').mockReturnValue(UNDETERMINED)
		const discover = vi.spyOn(repo_discovery, DISCOVER)

		doctor.main()

		expect(discover).not.toHaveBeenCalled()
	})
})
