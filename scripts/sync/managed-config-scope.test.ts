import { init_logic } from '#scripts/init/init-logic'
import {
	DISTRIBUTED_ROOT_FILE,
	DISTRIBUTED_SKILL_FILE,
	DISTRIBUTED_SYNC_ARTIFACT,
	SIBLING_DIRECTORY_FILE,
} from '#scripts/managed-config-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	AI_COPY_DIRECTORIES_LIST,
	AI_COPY_FILE_MAPPINGS_LIST,
	AI_COPY_FILES_LIST,
	managed_config_scope,
	SYNCED_PATHS_LIST,
} from './managed-config-scope'

const UNDISTRIBUTED_FILE = 'scripts/sync/managed-config-scope.ts'
const SKILL_DIRECTORY = '.claude/skills/workflow-commands'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('managed_config_scope.find_managed_paths', () => {
	it('claims a root file that AI_COPY_FILES distributes', () => {
		const hits = managed_config_scope.find_managed_paths([DISTRIBUTED_ROOT_FILE])

		expect(hits).toEqual([{ path: DISTRIBUTED_ROOT_FILE, list: AI_COPY_FILES_LIST }])
	})

	// The acceptance criterion of joshuafolkken/kit#1578: the run that skipped the gate changed this
	// exact file, and no eye-comparison against the array finds it, because the array holds the
	// directory rather than the file.
	it('claims a file under an AI_COPY_DIRECTORIES entry it does not textually equal', () => {
		const hits = managed_config_scope.find_managed_paths([DISTRIBUTED_SKILL_FILE])

		expect(hits).toEqual([{ path: DISTRIBUTED_SKILL_FILE, list: AI_COPY_DIRECTORIES_LIST }])
	})

	it('claims the distributed directory itself', () => {
		const hits = managed_config_scope.find_managed_paths([SKILL_DIRECTORY])

		expect(hits).toEqual([{ path: SKILL_DIRECTORY, list: AI_COPY_DIRECTORIES_LIST }])
	})

	it('leaves a path on none of the three lists alone', () => {
		expect(managed_config_scope.find_managed_paths([UNDISTRIBUTED_FILE])).toEqual([])
	})

	// The separator is the whole of the containment test: without it a sibling whose name merely
	// begins with a distributed directory would be reported as distributed.
	it('does not claim a sibling directory whose name begins with a distributed one', () => {
		expect(managed_config_scope.find_managed_paths([SIBLING_DIRECTORY_FILE])).toEqual([])
	})

	// `sync.ts` writes this one directly, so no `AI_COPY_*` list holds it. A matcher built from those
	// three alone answered "not distributed" for the file the replaced prose used as its own worked
	// example (joshuafolkken/kit#1578).
	it('claims a file josh sync writes outside the three AI_COPY lists', () => {
		const hits = managed_config_scope.find_managed_paths([DISTRIBUTED_SYNC_ARTIFACT])

		expect(hits).toEqual([{ path: DISTRIBUTED_SYNC_ARTIFACT, list: SYNCED_PATHS_LIST }])
	})

	it('reports one hit per path, in the order the paths arrived', () => {
		const hits = managed_config_scope.find_managed_paths([
			UNDISTRIBUTED_FILE,
			DISTRIBUTED_SKILL_FILE,
			DISTRIBUTED_ROOT_FILE,
		])

		expect(hits.map((hit) => hit.path)).toEqual([DISTRIBUTED_SKILL_FILE, DISTRIBUTED_ROOT_FILE])
	})
})

describe('managed_config_scope.find_managed_paths — AI_COPY_FILE_MAPPINGS', () => {
	const MAPPING = { src: 'templates/workflows/probe.yml', dest: '.github/workflows/probe.yml' }

	function stub_mappings(): void {
		vi.spyOn(init_logic, 'get_ai_copy_file_mappings').mockReturnValue([MAPPING])
	}

	it('claims the package-internal source path', () => {
		stub_mappings()

		expect(managed_config_scope.find_managed_paths([MAPPING.src])).toEqual([
			{ path: MAPPING.src, list: AI_COPY_FILE_MAPPINGS_LIST },
		])
	})

	it('claims the consumer destination path', () => {
		stub_mappings()

		expect(managed_config_scope.find_managed_paths([MAPPING.dest])).toEqual([
			{ path: MAPPING.dest, list: AI_COPY_FILE_MAPPINGS_LIST },
		])
	})
})

describe('managed_config_scope.has_managed_path', () => {
	it('answers true when any path is distributed', () => {
		expect(managed_config_scope.has_managed_path([UNDISTRIBUTED_FILE, DISTRIBUTED_ROOT_FILE])).toBe(
			true,
		)
	})

	it('answers false for a diff that touches nothing distributed', () => {
		expect(managed_config_scope.has_managed_path([UNDISTRIBUTED_FILE])).toBe(false)
	})

	it('answers false for an empty diff', () => {
		expect(managed_config_scope.has_managed_path([])).toBe(false)
	})
})

describe('managed_config_scope.format_hits', () => {
	it('names the path and the list that claimed it, one per line', () => {
		const hits = managed_config_scope.find_managed_paths([
			DISTRIBUTED_ROOT_FILE,
			DISTRIBUTED_SKILL_FILE,
		])

		expect(managed_config_scope.format_hits(hits)).toBe(
			`${DISTRIBUTED_ROOT_FILE} (${AI_COPY_FILES_LIST})\n` +
				`${DISTRIBUTED_SKILL_FILE} (${AI_COPY_DIRECTORIES_LIST})`,
		)
	})

	it('renders an empty hit list as an empty string', () => {
		expect(managed_config_scope.format_hits([])).toBe('')
	})
})
