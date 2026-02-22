import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	EditorView,
} from "@codemirror/view";
import { RangeSetBuilder, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { startsWithCJK } from "./cjk";

// Regex patterns for emphasis markers that the parser may have missed.
// We look for literal ** or * surrounding content.
const STRONG_RE = /\*\*([^*]+)\*\*/g;
const EMPHASIS_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;

interface EmphasisMatch {
	absFrom: number;
	absTo: number;
	delimLen: number;
	cssClass: string;
}

/**
 * Checks whether a position in the syntax tree is already inside an
 * Emphasis or StrongEmphasis node (i.e., the parser handled it correctly).
 */
function isAlreadyEmphasis(view: EditorView, from: number, to: number): boolean {
	let found = false;
	syntaxTree(view.state).iterate({
		from,
		to,
		enter(node) {
			const name = node.name;
			if (
				name === "Emphasis" ||
				name === "StrongEmphasis" ||
				name === "EmphasisMark"
			) {
				found = true;
				return false; // stop
			}
		},
	});
	return found;
}

/**
 * Determines whether the emphasis match involves CJK context —
 * meaning it likely failed due to the CommonMark flanking bug.
 * We check: does the content contain CJK, AND is there a CJK or
 * punctuation character adjacent to the delimiter on the outside?
 */
function isCJKEmphasisContext(
	lineText: string,
	matchStart: number,
	matchEnd: number,
	delimLen: number
): boolean {
	const inner = lineText.slice(matchStart + delimLen, matchEnd - delimLen);
	// The inner content should contain at least one CJK character
	// or CJK punctuation for this fix to apply
	let hasCJK = false;
	for (let i = 0; i < inner.length; i++) {
		const code = inner.codePointAt(i)!;
		if (
			startsWithCJK(String.fromCodePoint(code)) ||
			isFullwidthPunctuation(code)
		) {
			hasCJK = true;
			break;
		}
	}
	if (!hasCJK) return false;

	// Also check: is there a CJK char or fullwidth punct adjacent outside?
	// Before the opening delimiter
	if (matchStart > 0) {
		const codeBefore = lineText.codePointAt(matchStart - 1);
		if (codeBefore !== undefined && (startsWithCJK(String.fromCodePoint(codeBefore)) || isFullwidthPunctuation(codeBefore))) {
			return true;
		}
	}
	// After the closing delimiter
	if (matchEnd < lineText.length) {
		const codeAfter = lineText.codePointAt(matchEnd);
		if (codeAfter !== undefined && (startsWithCJK(String.fromCodePoint(codeAfter)) || isFullwidthPunctuation(codeAfter))) {
			return true;
		}
	}

	// Even without adjacent CJK outside, if inside has CJK + punct at boundary
	// e.g., **テスト。** at end of line
	const firstInner = inner.codePointAt(0);
	const lastInner = inner.codePointAt(inner.length - 1);
	if (firstInner !== undefined && startsWithCJK(String.fromCodePoint(firstInner))) return true;
	if (lastInner !== undefined && (startsWithCJK(String.fromCodePoint(lastInner)) || isFullwidthPunctuation(lastInner))) return true;

	return false;
}

function isFullwidthPunctuation(code: number): boolean {
	return (
		// Ideographic Full Stop, Comma
		(code >= 0x3001 && code <= 0x3002) ||
		// CJK brackets 「」『』【】〈〉《》〔〕
		(code >= 0x300C && code <= 0x3011) ||
		(code >= 0x3014 && code <= 0x301B) ||
		// Fullwidth punctuation ！＂＃...
		(code >= 0xFF01 && code <= 0xFF0F) ||
		(code >= 0xFF1A && code <= 0xFF20) ||
		(code >= 0xFF3B && code <= 0xFF40) ||
		(code >= 0xFF5B && code <= 0xFF65)
	);
}

// CSS class for hiding the delimiter markers in Live Preview
const hideMarkDeco = Decoration.mark({ class: "cm-cjk-emphasis-mark" });

function collectMatches(
	view: EditorView,
	pattern: RegExp,
	lineText: string,
	lineFrom: number,
	delimLen: number,
	cssClass: string
): EmphasisMatch[] {
	const matches: EmphasisMatch[] = [];
	pattern.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(lineText)) !== null) {
		const matchStart = match.index;
		const matchEnd = matchStart + match[0].length;
		const absFrom = lineFrom + matchStart;
		const absTo = lineFrom + matchEnd;

		if (isAlreadyEmphasis(view, absFrom, absTo)) continue;
		if (!isCJKEmphasisContext(lineText, matchStart, matchEnd, delimLen)) continue;

		matches.push({ absFrom, absTo, delimLen, cssClass });
	}
	return matches;
}

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	const allMatches: EmphasisMatch[] = [];

	for (const { from, to } of view.visibleRanges) {
		const startLine = doc.lineAt(from).number;
		const endLine = doc.lineAt(to).number;

		for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
			const line = doc.line(lineNum);
			const lineText = line.text;
			const lineFrom = line.from;

			allMatches.push(
				...collectMatches(view, STRONG_RE, lineText, lineFrom, 2, "cm-cjk-strong"),
				...collectMatches(view, EMPHASIS_RE, lineText, lineFrom, 1, "cm-cjk-emphasis")
			);
		}
	}

	// RangeSetBuilder requires decorations in ascending position order
	allMatches.sort((a, b) => a.absFrom - b.absFrom);

	// Remove overlapping matches (Strong takes priority over Emphasis)
	const filtered: EmphasisMatch[] = [];
	let lastEnd = -1;
	for (const m of allMatches) {
		if (m.absFrom >= lastEnd) {
			filtered.push(m);
			lastEnd = m.absTo;
		}
	}

	for (const m of filtered) {
		builder.add(m.absFrom, m.absFrom + m.delimLen, hideMarkDeco);
		builder.add(
			m.absFrom + m.delimLen,
			m.absTo - m.delimLen,
			Decoration.mark({ class: m.cssClass })
		);
		builder.add(m.absTo - m.delimLen, m.absTo, hideMarkDeco);
	}

	return builder.finish();
}

const cjkEmphasisViewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{
		decorations: (v) => v.decorations,
	}
);

/**
 * Provides the EditorView theme with styles for the CJK emphasis fix.
 * In Obsidian's Live Preview, the native emphasis styling uses these
 * same CSS properties, so the result looks identical.
 */
const cjkEmphasisTheme = EditorView.baseTheme({
	".cm-cjk-strong": {
		fontWeight: "bold",
	},
	".cm-cjk-emphasis": {
		fontStyle: "italic",
	},
	// In Live Preview with cursor away, hide the delimiter markers
	// just like Obsidian does for normal emphasis
	".cm-cjk-emphasis-mark": {
		// We don't hide by default — Obsidian's Live Preview handles
		// showing/hiding based on cursor position through its own mechanism.
		// Our marks just need to be styled distinctly so they're recognized.
		color: "var(--text-faint)",
		fontSize: "0.9em",
	},
});

export function cjkEmphasisExtension(): Extension {
	return [cjkEmphasisViewPlugin, cjkEmphasisTheme];
}
