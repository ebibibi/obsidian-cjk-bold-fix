# obsidian-cjk-bold-fix

Obsidian plugin that fixes CJK (Chinese/Japanese/Korean) bold and italic rendering in Live Preview mode.

## Architecture

- **Approach**: ViewPlugin + Decoration (no monkey-patching)
- **Entry**: `src/main.ts` → registers `cjkEmphasisExtension()` via `registerEditorExtension`
- **Core**: `src/extension.ts` → ViewPlugin that detects un-parsed emphasis around CJK text
- **CJK Detection**: `src/cjk.ts` → Unicode range checks for CJK characters

## How it works

1. `buildDecorations()` scans visible lines for `**...**` and `*...*` patterns
2. `isAlreadyEmphasis()` checks if the lezer parser already handled the match
3. `isCJKEmphasisContext()` confirms CJK characters/punctuation are involved
4. Applies CSS decorations (`cm-cjk-strong`, `cm-cjk-emphasis`) where parser failed

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

## Test

Install to vault: copy `main.js` + `manifest.json` to `.obsidian/plugins/obsidian-cjk-bold-fix/`
Test note: `00_Inbox/CJK_Bold_Fix_Test.md`
