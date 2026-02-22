# CJK Bold Fix

An [Obsidian](https://obsidian.md) plugin that fixes **bold** and *italic* rendering for CJK (Chinese, Japanese, Korean) text in Live Preview mode.

## The Problem

Obsidian's Live Preview (editing mode) uses CodeMirror 6, which follows the CommonMark specification for emphasis parsing. The CommonMark spec's "left-flanking" and "right-flanking" delimiter run rules were designed for space-separated languages like English and break when CJK punctuation appears adjacent to emphasis markers.

### Examples of broken patterns

```markdown
は、**知識があれば**です。       ← Doesn't render as bold
**テスト。**テスト              ← Doesn't render as bold
これは**重要な**テキストです     ← Doesn't render as bold  
```

> **Note**: Reading mode (preview) renders correctly — the bug only affects Live Preview (editing mode).

This is a [known CommonMark issue (#650)](https://github.com/commonmark/commonmark-spec/issues/650) with 235+ comments, unresolved for 7+ years.

## How It Works

The plugin registers a CodeMirror 6 ViewPlugin that:

1. Scans visible text for `**...**` and `*...*` patterns
2. Checks if the parser already handled them (to avoid double-processing)
3. Detects CJK context (CJK characters or fullwidth punctuation near delimiters)
4. Applies bold/italic CSS decorations where the parser failed

## Installation

### From Community Plugins (coming soon)

Search for "CJK Bold Fix" in Obsidian's Community Plugins browser.

### Manual Installation

1. Download `main.js` and `manifest.json` from the latest release
2. Create a folder `obsidian-cjk-bold-fix` in your vault's `.obsidian/plugins/` directory
3. Copy the files into that folder
4. Enable the plugin in Obsidian's settings

## Supported Languages

- 🇯🇵 Japanese (Hiragana, Katakana, Kanji)
- 🇨🇳 Chinese (Simplified & Traditional)
- 🇰🇷 Korean (Hangul)

## Technical Details

- **Approach**: ViewPlugin + Decoration (no monkey-patching, no internal API dependencies)
- **Performance**: Only processes visible ranges, rebuilds only on document/viewport changes
- **Compatibility**: Uses only official Obsidian plugin APIs (`registerEditorExtension`)
- **Size**: ~3KB minified

## Related

- [CommonMark Issue #650](https://github.com/commonmark/commonmark-spec/issues/650) — The upstream specification issue
- [Obsidian Forum Discussion](https://forum.obsidian.md/t/parsers-problems-with-bold-italic-highlight-markers-and-whitespaces-and-punctuation-marks/105107)
- [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly) — Spec-level fix for various parsers

## License

MIT
