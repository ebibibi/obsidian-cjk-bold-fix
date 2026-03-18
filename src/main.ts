import { Plugin } from "obsidian";
import { cjkEmphasisExtension } from "./extension";

export default class CJKBoldFixPlugin extends Plugin {
	onload() {
		this.registerEditorExtension(cjkEmphasisExtension());
	}
}
