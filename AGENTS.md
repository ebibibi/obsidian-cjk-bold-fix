# cjk-bold-fix

Obsidian plugin that fixes CJK (Chinese/Japanese/Korean) bold and italic rendering in Live Preview mode.

## Architecture

- **Approach**: ViewPlugin + Decoration (no monkey-patching)
- **Entry**: `src/main.ts` → registers `cjkEmphasisExtension()` via `registerEditorExtension`
- **Core**: `src/extension.ts` → ViewPlugin with 4-phase decoration builder
- **CJK Detection**: `src/cjk.ts` → Unicode range checks for CJK characters

## How it works (4 phases)

1. **Phase 1**: Collect parser bold/italic ranges from HyperMD syntax tree (`strong`, `em` node names)
2. **Phase 2**: Find correct emphasis via per-line regex (`***...***`, `**...**`, `*...*` with CJK content)
3. **Phase 3**: Override wrong parser emphasis with `font-weight: normal !important`
4. **Phase 4**: Apply correct emphasis styling + hide `**`/`*` markers (cursor-aware: show when editing)

## Key discovery: Obsidian uses HyperMD node names

Standard `@lezer/markdown` uses `StrongEmphasis`/`Emphasis`, but Obsidian's HyperMD-based parser uses:
- `strong` → bold content
- `em` → italic content
- `formatting_formatting-strong_strong` → `**` markers
- `em_strong` → bold+italic content

## Build

```bash
npm install
npm run build     # production
npm run dev       # watch mode
```

## The Bug (CommonMark Issue #650)

The `@lezer/markdown` parser implements CommonMark flanking rules faithfully.
When CJK punctuation (。、「」etc) appears inside `**...**` adjacent to the delimiter,
and a CJK ideograph appears outside, the right-flanking check fails because:
- `pBefore=true` (punct inside) requires `sAfter||pAfter`
- CJK ideograph is neither whitespace nor punctuation → `canClose=false`

## Release

Plugin ID: `cjk-bold-fix` (no "obsidian" prefix — required by community plugin rules)

```bash
npm run build
gh release create 1.0.0 main.js manifest.json --title "1.0.0" --notes "Initial release"
```
