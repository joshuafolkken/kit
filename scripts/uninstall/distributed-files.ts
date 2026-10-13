import path from 'node:path'
import { init } from '#scripts/init/init'
import { init_actions } from '#scripts/init/init-actions'
import { CLAUDE_MD_FILENAME, init_ai_copy, WORKSPACE_YAML } from '#scripts/init/init-ai-copy'
import { init_basic } from '#scripts/init/init-basic'
import { package_path, PROJECT_ROOT } from '#scripts/init/init-paths'
import type { ProjectProfile, ProjectShape } from '#scripts/init/project-profile'
import { file_reader } from '#scripts/lib/read-file'
import { PACK_HOOK_FILE } from '#scripts/safe-chain/pack-hook'
import { sync_ai_files } from '#scripts/sync/sync-ai-files'
import { IGNORE_FILE, type DistributedFile } from './uninstall-plan'

// Every file the profile can write, whatever the project looks like today: a project that has since
// lost its last web file still holds the Prettier config kit wrote while it had one. Asking for the
// widest shape is safe because a file is only ever deleted while it equals what kit writes.
function widest_shape(profile: ProjectProfile): ProjectShape {
	return {
		profile,
		reason: 'josh uninstall',
		has_web: true,
		has_typescript: true,
		has_git: true,
		has_github: true,
	}
}

// Some content names the repository it lands in and cannot be produced where there is none. Such a
// file has no known distribution content, so it is kept.
function content_or_unknown(produce: () => string): string | undefined {
	try {
		return produce()
	} catch {
		return undefined
	}
}

function config_files(shape: ProjectShape): Array<DistributedFile> {
	return init_actions.build_file_actions(shape).map((action) => ({
		dest: action.dest,
		distributed: content_or_unknown(() => action.create()),
	}))
}

function copied_file(filename: string, shape: ProjectShape): DistributedFile {
	const source_path = package_path(init_ai_copy.ai_file_source(filename, shape))
	const destination_path = path.join(PROJECT_ROOT, filename)
	const read_content =
		filename === WORKSPACE_YAML ? init_ai_copy.workspace_content : init_ai_copy.copied_content

	return {
		dest: filename,
		distributed: content_or_unknown(() => read_content(source_path, destination_path)),
	}
}

function mapped_file(source: string, destination: string): DistributedFile {
	return {
		dest: destination,
		distributed: content_or_unknown(() =>
			init_ai_copy.copied_content(package_path(source), path.join(PROJECT_ROOT, destination)),
		),
	}
}

function ai_files(shape: ProjectShape): Array<DistributedFile> {
	return [
		{ dest: CLAUDE_MD_FILENAME, distributed: sync_ai_files.ensured_claude_md(undefined, shape) },
		...init_ai_copy.ai_files(shape).map((filename) => copied_file(filename, shape)),
		...init_ai_copy.ai_file_mappings(shape).map(({ src, dest }) => mapped_file(src, dest)),
		{ dest: PACK_HOOK_FILE, distributed: file_reader.read_optional(package_path(PACK_HOOK_FILE)) },
	]
}

// The lists are `josh init`'s and `josh sync`'s own — the same builders, read for what they would
// write and not run — so a file added to either is one this command already knows about. The ignore
// file is left out: it is named for review and never compared, so it can never be removed.
function list(profile: ProjectProfile): Array<DistributedFile> {
	const shape = widest_shape(profile)

	return [...config_files(shape), ...ai_files(shape)].filter((file) => file.dest !== IGNORE_FILE)
}

// What kit's merge writes into the manifest it starts a project without one from, which names every
// entry it adds — `private` included, the one entry that start alone writes.
function kit_manifest(profile: ProjectProfile): string {
	return init.merged_manifest(init_basic.initial_manifest(), widest_shape(profile))
}

const distributed_files = { list, kit_manifest }

export { distributed_files }
