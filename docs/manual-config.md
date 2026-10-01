# Manual config

For `full` projects that import kit's ESLint, Prettier and tsconfig presets by hand instead of running `josh init`. Use individual configs directly if you prefer not to use `josh init`:

Install ESLint and its plugins before importing the ESLint preset — a kit-only installation does not include them. They are kit's optional peer dependencies; `pnpm view @joshuafolkken/kit peerDependencies` lists each with the range kit supports.

```js
// eslint.config.js
import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
```

```js
// prettier.config.js
import { config } from '@joshuafolkken/kit/prettier'
```

The `@joshuafolkken/kit/prettier` preset loads `@ianvs/prettier-plugin-sort-imports`, `prettier-plugin-svelte` and `prettier-plugin-tailwindcss` by name, so install all three in the project ([init.md → Dependencies](./init.md#dependencies)). For a project without Svelte or Tailwind, import `@joshuafolkken/kit/prettier/basic` instead.

```jsonc
// tsconfig.json
{ "extends": ["@joshuafolkken/kit/tsconfig/base"] }
```

```yaml
# cspell.config.yaml
import:
  - node_modules/@joshuafolkken/kit/cspell/index.yaml
```

```yaml
# lefthook.yml
extends:
  - node_modules/@joshuafolkken/kit/lefthook/vanilla.yml
```
