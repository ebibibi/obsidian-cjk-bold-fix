import { Plugin } from "obsidian";
import { cjkEmphasisExtension } from "./extension";

export default class CJKBoldFixPlugin extends Plugin {
	async onload() {
		this.registerEditorExtension(cjkEmphasisExtension());
	}
}
