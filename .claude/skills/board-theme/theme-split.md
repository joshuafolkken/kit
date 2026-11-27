# Split a theme into children

Read from `SKILL.md` → "5. File the Issue once the user decides" when the user has decided a look
built in a work tree and asks to file the theme. Its effects are functions that take the board and
the tick and draw; that shape is the split. Each child takes those functions in unchanged in shape
and places them by kit's layout ([wiring](theme-wiring.md)).

## First: one seam child

- One child builds every socket the effects plug into, and merges before any effect child starts:
  - the theme's row in `THEME_DEFS` with every field (`name`, `intro`, `typing`, `typed_end`,
    `score`) and its alias row;
  - the theme's module in the registry, with its parts and `lasts`;
  - the colors;
  - the sound palette ([sound](theme-sound.md));
  - the signal each effect reads from the board;
  - the draw order — the order the theme's `draw` calls its effects;
  - the shared timing constants the effects read (jump ticks, run-up length, lead times);
  - per effect, its own file holding a function that draws nothing;
  - the new theme in the budget test ([render cost](render-cost.md)).
- An effect the existing fields cannot express needs a new `ThemeDefinition` field — add it here.

## Second: effect children in parallel

- One child per effect. It touches its own files and tests only, never a shared file
  (`run-board-theme-defs.ts` and the other files the seam child wrote).
- Each effect child keeps the budget test green with its effect drawing.
- Declare no dependency between effect children.
- Each effect child waits on the seam child only. Create the epic with one chain and one reason per
  effect child:

  ```sh
  --chain "#<seam> -> #<effect>" \
  --order-reason "#<seam> -> #<effect>: 1 パスで検証できない — the effect cannot be checked on the board before its socket exists"
  ```

## When filing: check the planned paths

- Compare the planned paths in every effect child's body. When two overlap, or one names a shared
  file, move that socket into the seam child and file again.
- A missing socket sends an effect child to a shared file, and the lanes queue one by one again.

## Compare with the decided look after every effect child has merged

- Run the comparison of `SKILL.md` → "6. After the first merge" after every effect child has
  merged — the combined look exists only then — not after the seam child.
