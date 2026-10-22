import { CONFIG_FILES, reuse_world, type World } from './reuse-world-fixture'

// joshuafolkken/kit#4494: the edits the reuse property tests combine. **Each step picks among the
// operations the world allows and then among their targets**, so every step changes something — a list
// of fixed edits would skip most of them on a path a deletion already removed.

interface Operation {
	name: string
	targets: (world: World) => ReadonlyArray<string>
	apply: (world: World, target: string) => void
}

interface Step {
	name: string
	apply: () => void
}

const RECORD = 'record a green run'
const MODULE_DIRECTORY = 'src'
const TYPES_DIRECTORY = 'types'
const AMBIENT_KINDS: ReadonlySet<string> = new Set(['declaration', 'globals'])

function existing(world: World): ReadonlyArray<string> {
	return [...world.contents.keys()].filter((relative) => !CONFIG_FILES.includes(relative))
}

function modules(world: World): ReadonlyArray<string> {
	return existing(world).filter((relative) => reuse_world.kind_of(relative) === 'module')
}

function imported(world: World): ReadonlyArray<string> {
	const targets = new Set([...world.imports.values()].flat())

	return modules(world).filter((relative) => targets.has(relative))
}

function ambient(world: World): ReadonlyArray<string> {
	return existing(world).filter((relative) => AMBIENT_KINDS.has(reuse_world.kind_of(relative)))
}

function new_path(world: World, directory: string, suffix: string): string {
	return `${directory}/n${String(world.revision)}${suffix}`
}

function add_module(world: World, target: string): void {
	const relative = new_path(world, MODULE_DIRECTORY, '.ts')

	world.imports.set(relative, [target])
	reuse_world.write(world, relative)
}

function add_declaration(world: World): void {
	reuse_world.write(world, new_path(world, TYPES_DIRECTORY, '.d.ts'))
}

function remove(world: World, target: string): void {
	world.contents.delete(target)
	world.imports.delete(target)
}

// Main changes a path the branch left alone, and the branch merges it: the content moves in both.
function move_base(world: World, target: string): void {
	reuse_world.write(world, target)
	const content = world.contents.get(target)

	if (content !== undefined) world.base_contents.set(target, content)
	world.upstream.push([target])
}

function unchanged_on_branch(world: World): ReadonlyArray<string> {
	return [...world.contents.keys()].filter(
		(relative) => !reuse_world.is_branch_change(world, relative),
	)
}

const OPERATIONS: ReadonlyArray<Operation> = [
	{ name: 'edit', targets: existing, apply: reuse_world.write },
	{ name: 'edit an imported module', targets: imported, apply: reuse_world.write },
	{ name: 'add a module importing', targets: modules, apply: add_module },
	{ name: 'add a declaration', targets: () => [TYPES_DIRECTORY], apply: add_declaration },
	{ name: 'delete', targets: existing, apply: remove },
	{ name: 'edit a config file', targets: () => CONFIG_FILES, apply: reuse_world.write },
	{ name: 'edit a declaration', targets: ambient, apply: reuse_world.write },
	{ name: 'move the merge base, changing', targets: unchanged_on_branch, apply: move_base },
	{
		name: RECORD,
		targets: () => [MODULE_DIRECTORY],
		apply: (world) => {
			world.recorded = reuse_world.snapshot(world)
		},
	},
]

function pick<T>(items: ReadonlyArray<T>, choice: number): T {
	const item = items[choice % items.length]

	if (item === undefined) throw new Error('nothing to pick from')

	return item
}

// The step `[operation, target]` picks in this world.
function step_of(world: World, choice: readonly [number, number]): Step {
	const operations = OPERATIONS.filter((operation) => operation.targets(world).length > 0)
	const operation = pick(operations, choice[0])
	const target = pick(operation.targets(world), choice[1])

	return {
		name: operation.name === RECORD ? RECORD : `${operation.name} ${target}`,
		apply: () => {
			operation.apply(world, target)
		},
	}
}

const reuse_operations = { step_of }

export type { Step }
export { RECORD, reuse_operations }
