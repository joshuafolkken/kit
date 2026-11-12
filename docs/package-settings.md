# Package settings

Every setting kit reads from the `josh` key of the project's `package.json`, in one place. Each one is optional, and kit reads none of them unless you write it: leave a setting out and kit behaves exactly as it would without it. A setting committed to `package.json` applies to every checkout, CI and every lane alike; an [environment variable](./environment-variables.md) set on one machine overrides the few that have one.

Two example files show these settings:

- [`package.json.full-example.jsonc`](../package.json.full-example.jsonc) lists every setting, with a comment on its values, its default and what happens when you leave it out. Read it to learn what you can write. `package.json` cannot hold comments, so remove them when you copy a part of it.
- `package.json.example` (joshuafolkken/kit#7373) is plain JSON with only the settings one project uses, meant to be pasted as it is.

`scripts/document/package-settings-reference.test.ts` checks that the rows below and the keys of the full example match the settings the schemas in `scripts/lib/package-manifest.ts` read, both ways, so a new setting cannot ship without a row here and a key there.

## `josh.review_gate`

Where the review gate runs. kit only reads the value for now: review execution does not change with it.

| Setting            | Value               | Default   |
| ------------------ | ------------------- | --------- |
| `josh.review_gate` | `"ci"` or `"local"` | `"local"` |

`JOSH_REVIEW_GATE` overrides it. kit reads the nearest `package.json` that declares it, searched upward from the working directory; an invalid value falls through to the next source.

```json
{ "josh": { "review_gate": "local" } }
```

Leave it out: the review gate setting reads `local`, as it always has.

## `josh.progress_interval_minutes`

How long a run goes quiet before [`josh run:progress`](./josh-commands-board.md#josh-runprogress) prints a line.

| Setting                          | Value                        | Default |
| -------------------------------- | ---------------------------- | ------- |
| `josh.progress_interval_minutes` | a positive number of minutes | `20`    |

`--interval` wins, then `JOSH_PROGRESS_INTERVAL_MINUTES`, then the nearest `package.json` that declares it, searched upward. An unusable value falls through to the next source.

```json
{ "josh": { "progress_interval_minutes": 30 } }
```

Leave it out: a run reports after 20 quiet minutes.

## `josh.format`

What Prettier formats and checks in a basic project (`josh format`, `josh lint`, `josh lint:related`). A full project always formats every file type. There is no environment variable, so local runs and CI format the same files.

| Setting       | Value               | Default  |
| ------------- | ------------------- | -------- |
| `josh.format` | `"auto"` or `"all"` | `"auto"` |

`auto` formats only the HTML, CSS and JavaScript files that enabled Prettier; `all` formats every file type Prettier reads, such as Markdown, JSON and YAML.

```json
{ "josh": { "format": "all" } }
```

Leave it out: a basic project formats only its HTML, CSS and JavaScript.

## `josh.lane.setup`

One shell command [`josh lane:open`](./josh-commands-lane.md#josh-laneopen--josh-laneclose--josh-lanelist--josh-laneprune) runs once in a new lane, after the install and cache seeding. It runs in the lane's directory with `JOSH_MAIN_CHECKOUT` set to the main checkout's path, so it can copy what the lane needs from there. A command that fails stops `lane:open` and leaves the lane open.

| Setting           | Value                       | Default |
| ----------------- | --------------------------- | ------- |
| `josh.lane.setup` | one non-empty shell command | unset   |

```json
{ "josh": { "lane": { "setup": "cp -R \"$JOSH_MAIN_CHECKOUT/target\" target" } } }
```

Leave it out: a new lane runs nothing beyond kit's own setup.

## `josh.gate.steps`

The project's own checks: [`josh gate`](./josh-commands.md#josh-gate) runs each step's command after its fixed checks and reports it under the step's name. A definition the schema rejects fails the gate with a result naming what it rejected.

| Setting                     | Value                                                                             | Default                         |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------------------- |
| `josh.gate.steps`           | a list of steps, run in order                                                     | unset                           |
| `josh.gate.steps[].name`    | the label the result is reported under; unique, letters, digits, `_`, `.` and `-` | required                        |
| `josh.gate.steps[].command` | the shell command to run                                                          | required                        |
| `josh.gate.steps[].paths`   | a non-empty list of paths                                                         | unset: the step runs every time |
| `josh.gate.steps[].cores`   | a positive whole number of CPU cores                                              | unset: the whole machine        |

A step with `paths` is skipped when none of them moved since it last passed. A step without `cores` claims the whole machine, so heavy steps run one at a time; a `cores` above the machine's budget claims all of it.

```json
{
	"josh": {
		"gate": {
			"steps": [
				{ "name": "core", "command": "cargo test -p core", "paths": ["crates/core"], "cores": 4 }
			]
		}
	}
}
```

Leave it out: `josh gate` runs only its fixed checks.

## `josh.worker`

Picks the model and effort each lane worker runs on, per Issue, for a [`josh backlogrun`](./josh-commands-backlog.md). kit never picks a profile from an Issue's content: a person chooses it with a label.

| Setting                         | Value                                                        | Default  |
| ------------------------------- | ------------------------------------------------------------ | -------- |
| `josh.worker.default`           | the name of the profile an unlabelled Issue runs on          | required |
| `josh.worker.escalate`          | `true` lets a stuck worker resume one profile up             | `false`  |
| `josh.worker.profiles`          | a non-empty list of profiles, weakest first                  | required |
| `josh.worker.profiles[].name`   | the profile's name, unique; the label is `worker:<name>`     | required |
| `josh.worker.profiles[].model`  | a Claude model, such as `claude-sonnet-5-5`                  | required |
| `josh.worker.profiles[].effort` | `"low"`, `"medium"`, `"high"`, `"xhigh"` or `"max"`          | required |
| `josh.worker.profiles[].when`   | the work the profile is for, shown to whoever files an Issue | required |

How kit uses it:

- Choosing a profile: an Issue labelled `worker:<name>` runs on that profile; an Issue with no such label runs on `default`. More than one `worker:` label, or one naming no profile, stops the lane's dispatch with a note. [`josh issue:file`](./josh-commands-backlog.md) prints the profiles with their `when`, refuses a `worker:` label naming none of them and creates the chosen label.
- Environment variables: the chosen profile wins over `JOSH_WORKER_MODEL` and `JOSH_WORKER_EFFORT`. Those two, and kit's defaults, decide only when `josh.worker` is unset.
- Model and effort: a profile is held to the same rules as `JOSH_WORKER_MODEL` / `JOSH_WORKER_EFFORT`; a consultation model (Fable) is rejected. Every profile names an effort, because kit always passes one: give a model without an effort setting, such as Haiku, `"low"`.
- The ship phase: once a lane reaches the gate it relaunches on the ship model (`JOSH_WORKER_SHIP_MODEL`, default `claude-sonnet-5-5`) at effort `low`, but never on a model above the Issue's profile: the weaker of the two, ranked by the order of `profiles`, wins. A ship model no profile names is kept.
- Escalation: with `escalate: true`, a worker that is stuck on its profile parks with `josh run:park <N> --escalate "<reason>"`; the run moves the Issue's label to the next profile in `profiles` and resumes the same lane there. At the last profile the Issue goes to a person instead.

```json
{
	"josh": {
		"worker": {
			"default": "opus-medium",
			"escalate": true,
			"profiles": [
				{
					"name": "haiku",
					"model": "claude-haiku-5-5",
					"effort": "low",
					"when": "Mechanical work with a command that checks it"
				},
				{
					"name": "sonnet-low",
					"model": "claude-sonnet-5-5",
					"effort": "low",
					"when": "Docs, merges, renames, small fixes"
				},
				{
					"name": "opus-medium",
					"model": "claude-opus-5-5",
					"effort": "medium",
					"when": "Most work: unfamiliar systems, or an unknown cause"
				}
			]
		}
	}
}
```

Leave it out: every lane worker runs on `JOSH_WORKER_MODEL` / `JOSH_WORKER_EFFORT` or kit's defaults, kit reads no `worker:` label, and no worker escalates.

## Written by kit

`josh.workflow` is not a setting you write. `josh start` records `"workflow": "github"` there, and every later `josh init` and `josh sync` reads it to give a `basic` project `.claude/settings.json` ([`JOSH_WORKFLOW`](./environment-variables.md)).
