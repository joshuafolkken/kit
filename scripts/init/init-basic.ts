import { json_format } from '#scripts/config-merge/json-format'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { init_logic } from './init-logic'
import type { ProjectShape } from './project-profile'

const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const record_schema = z.record(z.string(), z.unknown())

interface BasicVersions {
	kit: string
	prettier: string
}

function initial_manifest(): string {
	return json_format.format_json({ private: true })
}

function with_recorded_profile(content: string, profile: ProjectShape['profile']): string {
	const parsed: unknown = JSON.parse(content)
	const manifest = record_schema.parse(parsed)
	const existing = manifest['josh']
	const josh = json_value.is_record(existing) ? existing : {}

	manifest['josh'] = { ...josh, profile }

	return json_format.format_json(manifest)
}

function merge_basic_manifest(
	content: string,
	shape: ProjectShape,
	versions: BasicVersions,
): string {
	const with_profile = with_recorded_profile(content, shape.profile)
	const with_script = init_logic.merge_package_scripts(with_profile, {
		preinstall: init_logic.SAFE_CHAIN_CMD,
		josh: 'josh',
	})
	const with_kit = init_logic.merge_development_dependencies(with_script, {
		[KIT_PACKAGE_NAME]: versions.kit,
	})
	const with_prettier = shape.has_web
		? init_logic.merge_development_dependencies(with_kit, { prettier: versions.prettier })
		: with_kit

	return init_logic.sort_package_json_keys(with_prettier)
}

const init_basic = { initial_manifest, with_recorded_profile, merge_basic_manifest }
export { init_basic }
export type { BasicVersions }
