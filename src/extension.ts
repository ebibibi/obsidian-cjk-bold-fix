import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	EditorView,
} from "@codemirror/view";
import { Extension, Prec, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { isCJKCharacter } from "./cjk";

const STRONG_RE = /\*\*(.+?)\*\*/g;
const EMPHASIS_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;

interface MatchRange {
	from: number;
	to: number;
	contentFrom: number;
	contentTo: number;
	delimLen: number;
	cssClass: string;
}

function hasCJK(text: string): boolean {
	for (const ch of text) {
		const code = ch.codePointAt(0);
		if (code !== undefined && isCJKCharacter(code)) return true;
	}
	return false;
}

function isFullwidthPunct(code: number): boolean {
	return (
		(code >= 0x3001 && code <= 0x3002) ||
		(code >= 0x300C && code <= 0x3011) ||
		(code >= 0x3014 && code <= 0x301B) ||
		(code >= 0xFF01 && code <= 0xFF0F) ||
		(code >= 0xFF1A && code <= 0xFF20) ||
		(code >= 0xFF3B && code <= 0xFF40) ||
		(code >= 0xFF5B && code <= 0xFF65)
	);
}

function hasFullwidthPunct(text: string): boolean {
	for (const ch of text) {
		const code = ch.codePointAt(0);
		if (code !== undefined && isFullwidthPunct(code)) return true;
	}
	return false;
}

function isCJKRelated(text: string): boolean {
	return hasCJK(text) || hasFullwidthPunct(text);
}

/**
 * Subtract exclude ranges from a base range, returning non-overlapping pieces.
 */
function subtractRanges(
	from: number,
	to: number,
	excludes: { from: number; to: number }[]
): { from: number; to: number }[] {
	const result: { from: number; to: number }[] = [];
	const sorted = [...excludes]
		.filter((e) => e.from < to && e.to > from)
		.sort((a, b) => a.from - b.from);

	let cursor = from;
	for (const exc of sorted) {
		if (exc.from > cursor) {
			result.push({ from: cursor, to: Math.min(exc.from, to) });
		}
		cursor = Math.max(cursor, exc.to);
	}
	if (cursor < to) {
		result.push({ from: cursor, to });
	}
	return result;
}

function buildDecorations(view: EditorView): DecorationSet {
	const decoRanges: Range<Decoration>[] = [];
	const doc = view.state.doc;
	const tree = syntaxTree(view.state);

	// Phase 1: Collect parser emphasis nodes
	const parserNodes: { from: number; to: number; name: string }[] = [];
	tree.iterate({
		enter(node) {
			if (node.name === "StrongEmphasis" || node.name === "Emphasis") {
				parserNodes.push({
					from: node.from,
					to: node.to,
					name: node.name,
				});
			}
		},
	});

	// Phase 2: Find correct emphasis via regex (per line)
	const correctMatches: MatchRange[] = [];

	for (const { from, to } of view.visibleRanges) {
		const startLine = doc.lineAt(from).number;
		const endLine = doc.lineAt(to).number;

		for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
			const line = doc.line(lineNum);
			const lineText = line.text;
			const lineFrom = line.from;

			// Find **...**
			STRONG_RE.lastIndex = 0;
			let match;
			while ((match = STRONG_RE.exec(lineText)) !== null) {
				const inner = match[1];
				if (!isCJKRelated(inner)) continue;

				const mFrom = lineFrom + match.index;
				const mTo = mFrom + match[0].length;
				correctMatches.push({
					from: mFrom,
					to: mTo,
					contentFrom: mFrom + 2,
					contentTo: mTo - 2,
					delimLen: 2,
					cssClass: "cm-cjk-strong",
				});
			}

			// Find *...*
			EMPHASIS_RE.lastIndex = 0;
			while ((match = EMPHASIS_RE.exec(lineText)) !== null) {
				const inner = match[1];
				if (!isCJKRelated(inner)) continue;

				const mFrom = lineFrom + match.index;
				const mTo = mFrom + match[0].length;

				// Skip if overlaps with a strong match
				const overlaps = correctMatches.some(
					(cm) => mFrom < cm.to && mTo > cm.from
				);
				if (overlaps) continue;

				correctMatches.push({
					from: mFrom,
					to: mTo,
					contentFrom: mFrom + 1,
					contentTo: mTo - 1,
					delimLen: 1,
					cssClass: "cm-cjk-emphasis",
				});
			}
		}
	}

	// Phase 3: Override wrong parser emphasis
	const overrideDeco = Decoration.mark({ class: "cm-cjk-fix-override" });

	for (const pe of parserNodes) {
		const delimLen = pe.name === "StrongEmphasis" ? 2 : 1;
		const contentFrom = pe.from + delimLen;
		const contentTo = pe.to - delimLen;
		if (contentFrom >= contentTo) continue;

		const content = doc.sliceString(contentFrom, contentTo);

		// Only process CJK-related emphasis
		if (!isCJKRelated(content)) continue;

		// Check if this parser emphasis matches one of our correct matches
		const isCorrect = correctMatches.some(
			(cm) => cm.from === pe.from && cm.to === pe.to
		);
		if (isCorrect) continue;

		// This parser emphasis is WRONG → override it
		// But exclude ranges where we want our own correct emphasis
		const pieces = subtractRanges(
			pe.from,
			pe.to,
			correctMatches.map((cm) => ({ from: cm.from, to: cm.to }))
		);
		for (const piece of pieces) {
			if (piece.from < piece.to) {
				decoRanges.push(overrideDeco.range(piece.from, piece.to));
			}
		}
	}

	// Phase 4: Apply correct emphasis decorations
	const markDeco = Decoration.mark({ class: "cm-cjk-emphasis-mark" });

	for (const cm of correctMatches) {
		// Check if parser already handles this correctly
		const parserCorrect = parserNodes.some(
			(pe) => pe.from === cm.from && pe.to === cm.to
		);
		if (parserCorrect) continue;

		// Add delimiter marks
		decoRanges.push(markDeco.range(cm.from, cm.from + cm.delimLen));
		// Add content styling
		decoRanges.push(
			Decoration.mark({ class: cm.cssClass }).range(
				cm.contentFrom,
				cm.contentTo
			)
		);
		// Add closing delimiter marks
		decoRanges.push(markDeco.range(cm.to - cm.delimLen, cm.to));
	}

	return Decoration.set(decoRanges, true);
}

const cjkEmphasisViewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet
			) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{
		decorations: (v) => v.decorations,
	}
);

const cjkEmphasisTheme = EditorView.baseTheme({
	".cm-cjk-strong": {
		fontWeight: "bold !important",
	},
	".cm-cjk-emphasis": {
		fontStyle: "italic !important",
	},
	".cm-cjk-emphasis-mark": {
		color: "var(--text-faint)",
		fontSize: "0.9em",
	},
	".cm-cjk-fix-override": {
		fontWeight: "normal !important",
		fontStyle: "normal !important",
	},
});

export function cjkEmphasisExtension(): Extension {
	return [Prec.highest(cjkEmphasisViewPlugin), cjkEmphasisTheme];
}
