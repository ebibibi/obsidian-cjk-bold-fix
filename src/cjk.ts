/**
 * CJK character detection utilities.
 *
 * Determines whether a Unicode code point belongs to a CJK script block.
 * Used to override CommonMark's flanking rules so that emphasis delimiters
 * adjacent to CJK characters are treated correctly.
 */

/**
 * Returns true if the code point is a CJK ideograph, kana, or hangul —
 * characters that appear in spaceless scripts where CommonMark emphasis
 * rules break.
 */
export function isCJKCharacter(code: number): boolean {
	return (
		// CJK Unified Ideographs
		(code >= 0x4E00 && code <= 0x9FFF) ||
		// CJK Unified Ideographs Extension A
		(code >= 0x3400 && code <= 0x4DBF) ||
		// CJK Unified Ideographs Extension B
		(code >= 0x20000 && code <= 0x2A6DF) ||
		// CJK Compatibility Ideographs
		(code >= 0xF900 && code <= 0xFAFF) ||
		// Hiragana
		(code >= 0x3040 && code <= 0x309F) ||
		// Katakana
		(code >= 0x30A0 && code <= 0x30FF) ||
		// Katakana Phonetic Extensions
		(code >= 0x31F0 && code <= 0x31FF) ||
		// Hangul Syllables
		(code >= 0xAC00 && code <= 0xD7AF) ||
		// Hangul Jamo
		(code >= 0x1100 && code <= 0x11FF) ||
		// Hangul Compatibility Jamo
		(code >= 0x3130 && code <= 0x318F) ||
		// Bopomofo
		(code >= 0x3100 && code <= 0x312F) ||
		// Bopomofo Extended
		(code >= 0x31A0 && code <= 0x31BF) ||
		// CJK Radicals Supplement
		(code >= 0x2E80 && code <= 0x2EFF) ||
		// Kangxi Radicals
		(code >= 0x2F00 && code <= 0x2FDF) ||
		// CJK Symbols and Punctuation
		(code >= 0x3000 && code <= 0x303F) ||
		// Halfwidth and Fullwidth Forms
		(code >= 0xFF00 && code <= 0xFFEF) ||
		// Enclosed CJK Letters and Months
		(code >= 0x3200 && code <= 0x32FF) ||
		// CJK Compatibility
		(code >= 0x3300 && code <= 0x33FF)
	);
}

/**
 * Returns true if the string starts with a CJK character.
 * Handles surrogate pairs for characters outside the BMP.
 */
export function startsWithCJK(s: string): boolean {
	if (s.length === 0) return false;
	const code = s.codePointAt(0);
	return code !== undefined && isCJKCharacter(code);
}
