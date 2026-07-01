# Manual config

Use individual configs directly if you prefer not to use `josh init`:

```js
// eslint.config.js
import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
```

```js
// prettier.config.js
import { config } from '@joshuafolkken/kit/prettier'
```

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
