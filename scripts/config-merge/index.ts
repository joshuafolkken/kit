// Public entry point for the parameterized config-merge library (`@joshuafolkken/kit/config-merge`).
// Both kit's own `josh sync` / `josh init` and downstream consumers (app-kit) drive their cspell
// `import` and tsconfig `extends` patches through `config_merge`, which exposes ensure + remove
// semantics for one YAML or JSON list field while preserving every other key, value, and ordering.
// Comments are not preserved in this first cut — see the value-only decision recorded on the issue.
import { json_list } from './patch-json-list'
import { yaml_list } from './patch-yaml-list'

const config_merge = {
	patch_yaml_list_field: yaml_list.patch_yaml_list_field,
	read_yaml_list_field: yaml_list.read_yaml_list_field,
	patch_json_list_field: json_list.patch_json_list_field,
}

export type { ListEntryMatcher } from './list-patch'
export type { PatchYamlListOptions, YamlFieldPosition } from './patch-yaml-list'
export type { PatchJsonListOptions } from './patch-json-list'
export { config_merge }
