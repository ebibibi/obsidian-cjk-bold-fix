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

const STRONG_EM_RE = /\*\*\*(.+?)\*\*\*/g;
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
 * Merge overlapping/adjacent ranges into contiguous blocks.
 */
function mergeRanges(
	ranges: { from: number; to: number }[]
): { from: number; to: number }[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.from - b.from);
	const merged: { from: number; to: number }[] = [{ ...sorted[0] }];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		if (sorted[i].from <= last.to) {
			last.to = Math.max(last.to, sorted[i].to);
		} else {
			merged.push({ ...sorted[i] });
		}
	}
	return merged;
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
	const cursorHead = view.state.selection.main.head;

	// Phase 1: Collect parser bold/italic ranges using HyperMD node names
	const rawStrongRanges: { from: number; to: number }[] = [];
	const rawEmRanges: { from: number; to: number }[] = [];
	// Also collect formatting marker positions for wrong emphasis override
	const rawFormattingStrongRanges: { from: number; to: number }[] = [];
	const rawFormattingEmRanges: { from: number; to: number }[] = [];

	tree.iterate({
		enter(node) {
			const name = node.name;

			if (name.includes("formatting")) {
				// Formatting markers (** or *)
				if (name.includes("strong")) {
					rawFormattingStrongRanges.push({
						from: node.from,
						to: node.to,
					});
				} else if (name.includes("em")) {
					rawFormattingEmRanges.push({
						from: node.from,
						to: node.to,
					});
				}
				return;
			}

			if (!name.includes("strong") && !name.includes("em")) return;

			if (name.includes("strong")) {
				rawStrongRanges.push({ from: node.from, to: node.to });
			}
			if (
				(name === "em" ||
					name.startsWith("em_") ||
					name.includes("_em")) &&
				!name.includes("strong")
			) {
				rawEmRanges.push({ from: node.from, to: node.to });
			}
		},
	});

	const parserBoldRanges = mergeRanges(rawStrongRanges);
	const parserEmRanges = mergeRanges(rawEmRanges);

	// Phase 2: Find correct emphasis via regex (per line)
	const correctMatches: MatchRange[] = [];

	for (const { from, to } of view.visibleRanges) {
		const startLine = doc.lineAt(from).number;
		const endLine = doc.lineAt(to).number;

		for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
			const line = doc.line(lineNum);
			const lineText = line.text;
			const lineFrom = line.from;
			let match;

			// Find ***...*** (bold+italic) FIRST
			STRONG_EM_RE.lastIndex = 0;
			while ((match = STRONG_EM_RE.exec(lineText)) !== null) {
				const inner = match[1];
				if (!isCJKRelated(inner)) continue;

				const mFrom = lineFrom + match.index;
				const mTo = mFrom + match[0].length;
				correctMatches.push({
					from: mFrom,
					to: mTo,
					contentFrom: mFrom + 3,
					contentTo: mTo - 3,
					delimLen: 3,
					cssClass: "cm-cjk-strong-em",
				});
			}

			// Find **...** (bold only)
			STRONG_RE.lastIndex = 0;
			while ((match = STRONG_RE.exec(lineText)) !== null) {
				const inner = match[1];
				if (!isCJKRelated(inner)) continue;

				const mFrom = lineFrom + match.index;
				const mTo = mFrom + match[0].length;

				// Skip if overlaps with a bold+italic match
				const overlaps = correctMatches.some(
					(cm) => mFrom < cm.to && mTo > cm.from
				);
				if (overlaps) continue;

				correctMatches.push({
					from: mFrom,
					to: mTo,
					contentFrom: mFrom + 2,
					contentTo: mTo - 2,
					delimLen: 2,
					cssClass: "cm-cjk-strong",
				});
			}

			// Find *...* (italic only)
			EMPHASIS_RE.lastIndex = 0;
			while ((match = EMPHASIS_RE.exec(lineText)) !== null) {
				const inner = match[1];
				if (!isCJKRelated(inner)) continue;

				const mFrom = lineFrom + match.index;
				const mTo = mFrom + match[0].length;

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

	// Phase 3: Override WRONG parser bold/italic
	const overrideDeco = Decoration.mark({ class: "cm-cjk-fix-override" });

	for (const pbr of parserBoldRanges) {
		const content = doc.sliceString(pbr.from, pbr.to);
		if (!isCJKRelated(content)) continue;

		const overlappingCorrect = correctMatches.filter(
			(cm) =>
				(cm.cssClass === "cm-cjk-strong" ||
					cm.cssClass === "cm-cjk-strong-em") &&
				cm.contentFrom < pbr.to &&
				cm.contentTo > pbr.from
		);

		if (overlappingCorrect.length === 0) {
			decoRanges.push(overrideDeco.range(pbr.from, pbr.to));
		} else {
			const pieces = subtractRanges(
				pbr.from,
				pbr.to,
				overlappingCorrect.map((cm) => ({
					from: cm.contentFrom,
					to: cm.contentTo,
				}))
			);
			for (const p of pieces) {
				if (p.from < p.to) {
					decoRanges.push(overrideDeco.range(p.from, p.to));
				}
			}
		}
	}

	// Also override formatting markers (** or *) that belong to wrong emphasis
	const allFormattingStrong = mergeRanges(rawFormattingStrongRanges);
	for (const fmr of allFormattingStrong) {
		// Check if this formatting marker is adjacent to a wrong bold range
		// (i.e., NOT part of a correct match)
		const isPartOfCorrectMatch = correctMatches.some(
			(cm) =>
				cm.cssClass === "cm-cjk-strong" &&
				((fmr.from >= cm.from && fmr.to <= cm.from + cm.delimLen) ||
					(fmr.from >= cm.to - cm.delimLen && fmr.to <= cm.to))
		);
		if (isPartOfCorrectMatch) continue;

		// Check if this formatting marker is adjacent to wrong parser bold
		const isAdjacentToWrongBold = parserBoldRanges.some((pbr) => {
			const content = doc.sliceString(pbr.from, pbr.to);
			if (!isCJKRelated(content)) return false;
			// Check if this parser bold is wrong (not fully covered by correct matches)
			const fullyCovered = correctMatches.some(
				(cm) =>
					cm.cssClass === "cm-cjk-strong" &&
					cm.contentFrom <= pbr.from &&
					cm.contentTo >= pbr.to
			);
			if (fullyCovered) return false;
			// Check adjacency: formatting marker is right before or after the bold range
			return fmr.to === pbr.from || fmr.from === pbr.to;
		});

		if (isAdjacentToWrongBold) {
			decoRanges.push(overrideDeco.range(fmr.from, fmr.to));
		}
	}

	// Same for wrong parser italic
	for (const per of parserEmRanges) {
		const content = doc.sliceString(per.from, per.to);
		if (!isCJKRelated(content)) continue;

		const overlappingCorrect = correctMatches.filter(
			(cm) =>
				cm.cssClass === "cm-cjk-emphasis" &&
				cm.contentFrom < per.to &&
				cm.contentTo > per.from
		);

		if (overlappingCorrect.length === 0) {
			decoRanges.push(overrideDeco.range(per.from, per.to));
		} else {
			const pieces = subtractRanges(
				per.from,
				per.to,
				overlappingCorrect.map((cm) => ({
					from: cm.contentFrom,
					to: cm.contentTo,
				}))
			);
			for (const p of pieces) {
				if (p.from < p.to) {
					decoRanges.push(overrideDeco.range(p.from, p.to));
				}
			}
		}
	}

	// Phase 4: Apply correct emphasis and hide markers
	const hideMarkerDeco = Decoration.mark({ class: "cm-cjk-hide-marker" });

	for (const cm of correctMatches) {
		// For bold+italic, check both bold and italic parser ranges
		let parserHandled = false;
		if (cm.cssClass === "cm-cjk-strong-em") {
			parserHandled =
				parserBoldRanges.some(
					(pr) =>
						pr.from <= cm.contentFrom && pr.to >= cm.contentTo
				) &&
				parserEmRanges.some(
					(pr) =>
						pr.from <= cm.contentFrom && pr.to >= cm.contentTo
				);
		} else {
			const targetRanges =
				cm.cssClass === "cm-cjk-strong"
					? parserBoldRanges
					: parserEmRanges;
			parserHandled = targetRanges.some(
				(pr) =>
					pr.from <= cm.contentFrom && pr.to >= cm.contentTo
			);
		}

		// Check if cursor is on the same line as this match
		const matchLine = doc.lineAt(cm.from).number;
		const cursorLine = doc.lineAt(cursorHead).number;
		const cursorOnLine = matchLine === cursorLine;

		// Always handle markers, even if parser handles the bold
		if (!cursorOnLine) {
			// Cursor NOT on line: hide markers completely
			decoRanges.push(
				hideMarkerDeco.range(cm.from, cm.from + cm.delimLen)
			);
			decoRanges.push(
				hideMarkerDeco.range(cm.to - cm.delimLen, cm.to)
			);
		}

		// Only add content styling if parser didn't handle it
		if (!parserHandled) {
			decoRanges.push(
				Decoration.mark({ class: cm.cssClass }).range(
					cm.contentFrom,
					cm.contentTo
				)
			);
		}
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
	".cm-cjk-strong-em": {
		fontWeight: "bold !important",
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
	".cm-cjk-hide-marker": {
		fontSize: "0 !important",
		overflow: "hidden !important",
	},
});

export function cjkEmphasisExtension(): Extension {
	return [Prec.highest(cjkEmphasisViewPlugin), cjkEmphasisTheme];
}
