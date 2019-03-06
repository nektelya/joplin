// Based on https://github.com/waylonflinn/markdown-it-katex

'use strict';

const { shim } = require('lib/shim');
const Setting = require('lib/models/Setting');
var katex = require('katex');
const katexCss = require('lib/csstojs/katex.css.js');

// Test if potential opening or closing delimieter
// Assumes that there is a "$" at state.src[pos]
function isValidDelim(state, pos) {
	var prevChar, nextChar,
		max = state.posMax,
		can_open = true,
		can_close = true;

	prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
	nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

	// Check non-whitespace conditions for opening and closing, and
	// check that closing delimeter isn't followed by a number
	if (prevChar === 0x20/* " " */ || prevChar === 0x09/* \t */ ||
			(nextChar >= 0x30/* "0" */ && nextChar <= 0x39/* "9" */)) {
		can_close = false;
	}
	if (nextChar === 0x20/* " " */ || nextChar === 0x09/* \t */) {
		can_open = false;
	}

	return {
		can_open: can_open,
		can_close: can_close
	};
}

function math_inline(state, silent) {
	var start, match, token, res, pos, esc_count;

	if (state.src[state.pos] !== "$") { return false; }

	res = isValidDelim(state, state.pos);
	if (!res.can_open) {
		if (!silent) { state.pending += "$"; }
		state.pos += 1;
		return true;
	}

	// First check for and bypass all properly escaped delimieters
	// This loop will assume that the first leading backtick can not
	// be the first character in state.src, which is known since
	// we have found an opening delimieter already.
	start = state.pos + 1;
	match = start;
	while ( (match = state.src.indexOf("$", match)) !== -1) {
		// Found potential $, look for escapes, pos will point to
		// first non escape when complete
		pos = match - 1;
		while (state.src[pos] === "\\") { pos -= 1; }

		// Even number of escapes, potential closing delimiter found
		if ( ((match - pos) % 2) == 1 ) { break; }
		match += 1;
	}

	// No closing delimter found.  Consume $ and continue.
	if (match === -1) {
		if (!silent) { state.pending += "$"; }
		state.pos = start;
		return true;
	}

	// Check if we have empty content, ie: $$.  Do not parse.
	if (match - start === 0) {
		if (!silent) { state.pending += "$$"; }
		state.pos = start + 1;
		return true;
	}

	// Check for valid closing delimiter
	res = isValidDelim(state, match);
	if (!res.can_close) {
		if (!silent) { state.pending += "$"; }
		state.pos = start;
		return true;
	}

	if (!silent) {
		token         = state.push('math_inline', 'math', 0);
		token.markup  = "$";
		token.content = state.src.slice(start, match);
	}

	state.pos = match + 1;
	return true;
}

function math_block(state, start, end, silent){
	var firstLine, lastLine, next, lastPos, found = false, token,
		pos = state.bMarks[start] + state.tShift[start],
		max = state.eMarks[start]

	if(pos + 2 > max){ return false; }
	if(state.src.slice(pos,pos+2)!=='$$'){ return false; }

	pos += 2;
	firstLine = state.src.slice(pos,max);

	if(silent){ return true; }
	if(firstLine.trim().slice(-2)==='$$'){
		// Single line expression
		firstLine = firstLine.trim().slice(0, -2);
		found = true;
	}

	for(next = start; !found; ){

		next++;

		if(next >= end){ break; }

		pos = state.bMarks[next]+state.tShift[next];
		max = state.eMarks[next];

		if(pos < max && state.tShift[next] < state.blkIndent){
			// non-empty line with negative indent should stop the list:
			break;
		}

		if(state.src.slice(pos,max).trim().slice(-2)==='$$'){
			lastPos = state.src.slice(0,max).lastIndexOf('$$');
			lastLine = state.src.slice(pos,lastPos);
			found = true;
		}

	}

	state.line = next + 1;

	token = state.push('math_block', 'math', 0);
	token.block = true;
	token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '')
	+ state.getLines(start + 1, next, state.tShift[start], true)
	+ (lastLine && lastLine.trim() ? lastLine : '');
	token.map = [ start, state.line ];
	token.markup = '$$';
	return true;
}

let assetsLoaded_ = false;

module.exports = function(context, ruleOptions) {
	// Keep macros that persist across Katex blocks to allow defining a macro
	// in one block and re-using it later in other blocks.
	// https://github.com/laurent22/joplin/issues/1105
	context.__katex = { macros: {} };

	const addContextAssets = () => {
		context.css['katex'] = katexCss;
		context.assetLoaders['katex'] = async () => {
			if (assetsLoaded_) return;

			// In node, the fonts are simply copied using copycss to where Katex expects to find them, which is under app/gui/note-viewer/fonts

			// In React Native, it's more complicated and we need to download and copy them to the right directory. Ideally, we should embed
			// them as an asset and copy them from there (or load them from there by modifying Katex CSS), but for now that will do.

			if (shim.isReactNative()) {
				// Fonts must go under the resourceDir directory because this is the baseUrl of NoteBodyViewer
				const baseDir = Setting.value('resourceDir');
				await shim.fsDriver().mkdir(baseDir + '/fonts');
				
				await shim.fetchBlob('https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.9.0-beta1/fonts/KaTeX_Main-Regular.woff2', { overwrite: false, path: baseDir + '/fonts/KaTeX_Main-Regular.woff2' });
				await shim.fetchBlob('https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.9.0-beta1/fonts/KaTeX_Math-Italic.woff2', { overwrite: false, path: baseDir + '/fonts/KaTeX_Math-Italic.woff2' });
				await shim.fetchBlob('https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.9.0-beta1/fonts/KaTeX_Size1-Regular.woff2', { overwrite: false, path: baseDir + '/fonts/KaTeX_Size1-Regular.woff2' });
			}

			assetsLoaded_ = true;
		};
	}

	return function(md, options) {
		// Default options

		options = options || {};
		options.macros = context.__katex.macros;

		// set KaTeX as the renderer for markdown-it-simplemath
		var katexInline = function(latex){
			options.displayMode = false;
			try{
				const added = katex.renderToString(latex, options);
				if (added) context.css['katex'] = katexCss;
				return added;
			} catch(error){
				if(options.throwOnError){ console.log(error); }
				return latex;
			}
		};

		var inlineRenderer = function(tokens, idx){
			const added = katexInline(tokens[idx].content);
			if (added) context.css['katex'] = katexCss;
			return added;
		};

		var katexBlock = function(latex){
			options.displayMode = true;
			try{
				return "<p>" + katex.renderToString(latex, options) + "</p>";
			} catch(error){
				if(options.throwOnError){ console.log(error); }
				return latex;
			}
		}

		var blockRenderer = function(tokens, idx){
			return  katexBlock(tokens[idx].content) + '\n';
		}

		md.inline.ruler.after('escape', 'math_inline', math_inline);
		md.block.ruler.after('blockquote', 'math_block', math_block, {
			alt: [ 'paragraph', 'reference', 'blockquote', 'list' ]
		});
		md.renderer.rules.math_inline = inlineRenderer;
		md.renderer.rules.math_block = blockRenderer;
	};
};