import type { Muya } from '../../../muya';
import type { IRenderCursor } from '../../../selection/types';
import type {
    CodeContentState,
    ICodeBlockState,
    IDiagramState,
    IFrontmatterState,
} from '../../../state/types';
import type CodeBlock from '../../commonMark/codeBlock';
import type Code from '../../commonMark/codeBlock/code';
import type HTMLPreview from '../../commonMark/html/htmlPreview';
import { CLASS_NAMES, HTML_TAGS, VOID_HTML_TAGS } from '../../../config';
import { ChangeSource } from '../../../types';
import { adjustOffset, escapeHTML, firstGraphemeLength, firstWordOfInfo, lastGraphemeLength, lineBounds } from '../../../utils';
import { computeLineCount, repositionLineNumberSpans, syncLineNumbersSpans } from '../../../utils/codeBlockLineNumbers';
import { getHighlightHtml, MARKER_HASH } from '../../../utils/highlightHTML';
import { detectLanguage } from '../../../utils/languageDetect';
import prism, { loadedLanguages, transformAliasToOrigin, walkTokens } from '../../../utils/prism/index';
import { tabText } from '../../../utils/tab';
import Content from '../../base/content';
import { ScrollPage } from '../../scrollPage';

function checkAutoIndent(text: string, offset: number) {
    const pairStr = text.substring(offset - 1, offset + 1);

    return /^(?:\{\}|\[\]|\(\)|><)$/.test(pairStr);
}

function getIndentSpace(text: string, offset: number) {
    const [lineStart, lineEnd] = lineBounds(text, offset);
    const match = /^(\s*)\S/.exec(text.slice(lineStart, lineEnd));

    return match ? match[1] : '';
}

// Assigning identical innerHTML replaces caret text nodes and can freeze WebKit input.
// Keep unchanged nodes alive.
function replaceIfChanged(domNode: HTMLElement, html: string) {
    if (domNode.innerHTML !== html)
        domNode.innerHTML = html;
}

function parseSelector(str = '') {
    const REG_EXP = /(#|\.)([^#.]+)/;
    let tag = '';
    let id = '';
    let className = '';
    let isVoid = false;
    let cap;

    for (const tagName of HTML_TAGS) {
        if (
            str.startsWith(tagName)
            && (!str[tagName.length] || /#|\./.test(str[tagName.length]))
        ) {
            tag = tagName;
            if ((VOID_HTML_TAGS as readonly string[]).includes(tagName))
                isVoid = true;

            str = str.substring(tagName.length);
        }
    }

    if (tag !== '') {
        cap = REG_EXP.exec(str);
        while (cap && str.length) {
            if (cap[1] === '#')
                id = cap[2];
            else
                className = cap[2];

            str = str.substring(cap[0].length);
            cap = REG_EXP.exec(str);
        }
    }

    return { tag, id, className, isVoid };
}

const LANG_HASH = {
    'html-block': 'html',
    'math-block': 'latex',
};

// Delay after the last content change before an untagged block is judged, so
// detection sees the finished paste/keystroke run rather than a fragment.
const AUTO_DETECT_LANGUAGE_DELAY = 600;

function hasStateMeta(
    state: CodeContentState,
): state is ICodeBlockState | IDiagramState | IFrontmatterState {
    return /code-block|diagram|frontmatter/.test(state.name);
}

class CodeBlockContent extends Content {
    private _initialLang: string;
    public override parent: Code | null = null;

    static override blockName = 'codeblock.content';

    static create(muya: Muya, state: CodeContentState) {
        const content = new CodeBlockContent(muya, state);

        return content;
    }

    // Info strings can include attributes; highlighting uses only their first word.
    private get _lang() {
        const { _codeContainer: codeContainer } = this;

        return firstWordOfInfo(codeContainer ? codeContainer.lang : this._initialLang);
    }

    private get _codeContainer() {
        return this.parent?.parent;
    }

    get outContainer() {
        const { _codeContainer: codeContainer } = this;

        return /code-block|frontmatter/.test(codeContainer!.blockName)
            ? codeContainer
            : codeContainer!.parent;
    }

    // Seeded at creation to avoid racing the preview’s initial async render.
    private _lastPreviewText: string;

    private _autoDetectTimer: ReturnType<typeof setTimeout> | null = null;
    // Seeded so the initial render pass never schedules a detection — blocks
    // the parser could not identify are re-judged only on real edits.
    private _autoDetectSeenText: string;

    constructor(muya: Muya, state: CodeContentState) {
        super(muya, state.text);
        this._lastPreviewText = state.text;
        this._autoDetectSeenText = state.text;
        if (hasStateMeta(state))
            this._initialLang = state.meta.lang;
        else
            this._initialLang = LANG_HASH[state.name];

        this.classList = [...this.classList, 'mu-codeblock-content'];
        this.attributes.frontMatter = muya.i18n.t('Input Front Matter...');
        this.attributes.math = muya.i18n.t('Input Mathematical Formula...');
        this.createDomNode();
    }

    override getAnchor() {
        return this.outContainer;
    }

    private _updatePreviewIfHave(text: string) {
        // update() runs during the initial create pass before this block is
        // attached, when outContainer cannot resolve its parent chain.
        if (!this._codeContainer)
            return;
        // Repeated renders can race async diagram creation and leave its SVG unmounted.
        if (text === this._lastPreviewText)
            return;
        this._lastPreviewText = text;
        if (this.outContainer?.attachments?.length)
            (this.outContainer?.attachments?.head as HTMLPreview).update(text);
    }

    override update(_cursor?: IRenderCursor, highlights = []) {
        const { _lang: lang, text } = this;
        const parentCode = this.parent as Code | null;
        if (parentCode?.copyButton && parentCode.parent?.blockName === 'code-block')
            parentCode.copyButton.hidden = !text;
        const fullLengthLang = transformAliasToOrigin([lang])[0];
        const domNode = this.domNode!;
        const code = escapeHTML(getHighlightHtml(text, highlights, true))
            .replace(new RegExp(MARKER_HASH['<'], 'g'), '<')
            .replace(new RegExp(MARKER_HASH['>'], 'g'), '>')
            .replace(new RegExp(MARKER_HASH['"'], 'g'), '"')
            .replace(new RegExp(MARKER_HASH['\''], 'g'), '\'');

        // A final newline lays out no line of its own, so the caret after it has
        // nowhere to sit (#5114). Appended after highlighting: Prism's
        // keep-markup drops empty elements. Wrapped: Chromium puts the caret
        // just before the <br>, and (content, childIndex) would read back as
        // text offset childIndex where (wrapper, 0) reads back as the text
        // length.
        const trailingBreak = text.endsWith('\n')
            ? `<span class="${CLASS_NAMES.MU_TRAILING_BREAK}"><br></span>`
            : '';

        if (
            fullLengthLang
            && /\S/.test(code)
            && loadedLanguages.has(fullLengthLang)
        ) {
            const wrapper = document.createElement('div');
            wrapper.classList.add(`language-${fullLengthLang}`);
            wrapper.innerHTML = code;
            prism.highlightElement(wrapper, false, function (this: HTMLElement) {
                replaceIfChanged(domNode, this.innerHTML + trailingBreak);
            });
        }
        else {
            replaceIfChanged(domNode, code + trailingBreak);
        }

        this._updateLineNumbers(text);
        // Re-render the math/diagram/html preview too; undo/redo reaches this
        // block only through update(), not inputHandler (#1632).
        this._updatePreviewIfHave(text);
        this._maybeScheduleLanguageDetection(text);
    }

    // Judging runs 600ms after the last content change, so pasted code and
    // quick keystroke runs settle before a language is chosen.
    private _maybeScheduleLanguageDetection(text: string) {
        if (text === this._autoDetectSeenText)
            return;
        this._autoDetectSeenText = text;

        if (this._autoDetectTimer !== null) {
            clearTimeout(this._autoDetectTimer);
            this._autoDetectTimer = null;
        }

        if (!this._autoDetectTarget())
            return;

        this._autoDetectTimer = setTimeout(() => {
            this._autoDetectTimer = null;
            this._applyDetectedLanguage();
        }, AUTO_DETECT_LANGUAGE_DELAY);
    }

    // The untagged fenced code block that auto-detection may fill, or null
    // when ineligible. Frontmatter and diagram blocks reuse this content
    // class and must stay untouched. Transient user state (focused language
    // input, IME) is checked at fire time only, so it cannot silently drop
    // the schedule.
    private _autoDetectTarget(): { codeBlock: CodeBlock; langInput: Content } | null {
        if (!this.muya.options.codeBlockAutoDetectLanguage)
            return null;

        const codeBlock = this._codeContainer as CodeBlock | null;
        if (!codeBlock || codeBlock.blockName !== 'code-block')
            return null;
        if (codeBlock.meta.type !== 'fenced')
            return null;
        if (firstWordOfInfo(codeBlock.lang))
            return null;
        if (codeBlock.langManuallyCleared)
            return null;
        if (!this.muya.canMutate)
            return null;

        const langInput = codeBlock.firstContentInDescendant();
        if (!langInput || langInput.blockName !== 'language-input')
            return null;
        // Never overwrite a language the user typed, fully or partially.
        if (langInput.text !== '')
            return null;

        return { codeBlock, langInput };
    }

    private _applyDetectedLanguage() {
        const target = this._autoDetectTarget();
        if (!target || !this.muya.isBlockInDocument(target.codeBlock))
            return;
        if (this.muya.editor.isComposing || this.muya.editor.activeContentBlock === target.langInput)
            return;

        const detected = detectLanguage(this.text);
        if (!detected)
            return;

        // Mirror the language selector's apply path: the input's text carries
        // the OT edit on meta.lang, then the block re-renders its grammar. No
        // content-change event — the picker must not surface on auto-fill.
        target.langInput.text = detected;
        target.langInput.update();
        target.codeBlock.lang = detected;
    }

    private _lastLineCount = -1;
    private _lineNumberResizeObserver: ResizeObserver | null = null;

    private _updateLineNumbers(text: string) {
        if (!this.muya.options.codeBlockLineNumbers)
            return;
        const wrapper = this.parent?.lineNumbersWrapper;
        if (wrapper == null)
            return;
        const count = computeLineCount(text);
        if (count !== this._lastLineCount) {
            syncLineNumbersSpans(wrapper, count);
            this._lastLineCount = count;
        }
        this._observeLineNumberResize(wrapper);
    }

    // Measure after layout so code gutters follow content, wrapping and font changes.
    private _observeLineNumberResize(wrapper: HTMLElement) {
        if (this._lineNumberResizeObserver != null || typeof ResizeObserver === 'undefined')
            return;
        const codeEl = this.domNode!;
        this._lineNumberResizeObserver = new ResizeObserver(() => {
            if (codeEl.isConnected && wrapper.isConnected)
                repositionLineNumberSpans(wrapper, codeEl);
            else
                this._lineNumberResizeObserver?.disconnect();
        });
        this._lineNumberResizeObserver.observe(codeEl);
    }

    override inputHandler(event: Event): void {
        if (this.isComposed)
            return;

        const textContent = this.domNode!.textContent!;
        const { start, end } = this.getCursor()!;
        const { text } = this.autoPair(
            event,
            textContent,
            start,
            end,
            false,
            false,
            'codeblock.content',
        );
        this.text = text;

        this._updatePreviewIfHave(text);

        this.setCursor(start!.offset, end!.offset, true);
    }

    override enterHandler(event: KeyboardEvent): void {
        event.preventDefault();

        if (event.shiftKey) {
            let cursorBlock;
            const nextContentBlock = this.nextContentInContext();
            if (nextContentBlock) {
                cursorBlock = nextContentBlock;
            }
            else {
                const newNodeState = {
                    name: 'paragraph',
                    text: '',
                };
                const newNode = ScrollPage.loadBlock(newNodeState.name).create(
                    this.muya,
                    newNodeState,
                );
                this.scrollPage?.append(newNode, ChangeSource.User);
                cursorBlock = newNode.firstChild;
            }
            const offset = adjustOffset(0, cursorBlock, event);
            cursorBlock.setCursor(offset, offset, true);

            return;
        }

        const indentation = tabText(this.muya.options.tabSize);
        const { start } = this.getCursor()!;
        const { text } = this;
        const autoIndent = checkAutoIndent(text, start.offset);
        const indent = getIndentSpace(text, start.offset);

        this.text
            = `${text.substring(0, start.offset)
            }\n${
                autoIndent ? `${indent + indentation}\n` : ''
            }${indent
            }${text.substring(start.offset)}`;

        let offset = start.offset + 1 + indent.length;

        if (autoIndent)
            offset += indentation.length;

        this.setCursor(offset, offset, true);
    }

    override tabHandler(event: KeyboardEvent): void {
        event.preventDefault();
        const { start, end } = this.getCursor()!;
        if (event.shiftKey || start.offset !== end.offset) {
            this.insertTab(event.shiftKey);
            return;
        }
        const { _lang: lang, text } = this;
        const isMarkupCodeContent = /markup|html|xml|svg|mathml/.test(lang);

        if (isMarkupCodeContent) {
            const lastWordBeforeCursor
                = text.substring(0, start.offset).split(/\s+/).pop() ?? '';
            const { tag, isVoid, id, className }
                = parseSelector(lastWordBeforeCursor);

            if (tag) {
                const preText = text.substring(
                    0,
                    start.offset - lastWordBeforeCursor.length,
                );
                const postText = text.substring(end.offset);
                let html = `<${tag}`;
                let startOffset = 0;
                let endOffset = 0;

                switch (tag) {
                    case 'img':
                        html += ' alt="" src=""';
                        startOffset = endOffset = html.length - 1;
                        break;

                    case 'input':
                        html += ' type="text"';
                        startOffset = html.length - 5;
                        endOffset = html.length - 1;
                        break;

                    case 'a':
                        html += ' href=""';
                        startOffset = endOffset = html.length - 1;
                        break;

                    case 'link':
                        html += ' rel="stylesheet" href=""';
                        startOffset = endOffset = html.length - 1;
                        break;
                }

                if (id)
                    html += ` id="${id}"`;

                if (className)
                    html += ` class="${className}"`;

                html += '>';

                if (startOffset === 0 && endOffset === 0)
                    startOffset = endOffset = html.length;

                if (!isVoid)
                    html += `</${tag}>`;

                this.text = preText + html + postText;
                this.setCursor(
                    startOffset + preText.length,
                    endOffset + preText.length,
                    true,
                );
            }
            else {
                this.insertTab();
            }
        }
        else {
            this.insertTab();
        }
    }

    override backspaceHandler(event: KeyboardEvent): void {
        const { start, end } = this.getCursor()!;
        if (start.offset === end.offset && start.offset === 0) {
            event.preventDefault();
            const { text, muya } = this;
            const state = {
                name: 'paragraph',
                text,
            };
            const newNode = ScrollPage.loadBlock(state.name).create(muya, state);
            this.outContainer!.replaceWith(newNode);
            const cursorBlock = newNode.lastContentInDescendant();

            return cursorBlock.setCursor(0, 0, true);
        }

        // Ctrl/Alt/Cmd+Backspace deletes a word or line: leave it to the browser (#5239).
        if (event.ctrlKey || event.altKey || event.metaKey)
            return;

        // Firefox needs manual deletion at a newline boundary.
        if (
            start.offset === end.offset
            && this.text[start.offset - 1] === '\n'
        ) {
            event.preventDefault();
            const { text } = this;
            this.text = text.substring(0, start.offset - 1) + text.substring(start.offset);
            this._updatePreviewIfHave(this.text);
            return this.setCursor(--start.offset, --end.offset, true);
        }
        // Firefox can misplace the caret at highlighted token boundaries; delete and restore it manually.
        if (start.offset === end.offset) {
            const { _lang: lang, text } = this;
            const fullLengthLang = transformAliasToOrigin([lang])[0];
            if (fullLengthLang && /\S/.test(text) && loadedLanguages.has(fullLengthLang)) {
                const tokens = prism.tokenize(text, prism.languages[fullLengthLang]);
                let offset = start.offset;
                let code = '';
                // Remove a whole character (grapheme cluster), not one UTF-16
                // code unit: half of an emoji's surrogate pair left in the text
                // crashes the next edit with "Invalid offset - splits unicode
                // bytes" (#4926).
                let removedLength = 0;

                walkTokens(tokens, (token) => {
                    if (typeof token.content === 'string') {
                        if (token.type === 'temp-text' && offset === firstGraphemeLength(token.content)) {
                            removedLength = offset;
                            token.content = token.content.substring(removedLength);
                        }
                        else if (token.type !== 'temp-text' && offset === token.length) {
                            removedLength = lastGraphemeLength(token.content);
                            token.content = token.content.substring(0, token.length - removedLength);
                        }
                    }
                    code += token.content;
                    offset -= token.length;
                });

                if (removedLength > 0) {
                    event.preventDefault();
                    this.text = code;
                    this._updatePreviewIfHave(this.text);
                    return this.setCursor(start.offset - removedLength, end.offset - removedLength, true);
                }
            }
        }
    }

    override keyupHandler(): void {
        if (this.isComposed)
            return;

        const { anchor, focus } = this.getCursor()!;
        const { anchor: oldAnchor, focus: oldFocus } = this.selection;

        if (
            anchor.offset !== oldAnchor?.offset
            || focus.offset !== oldFocus?.offset
        ) {
            this.setCursor(anchor.offset, focus.offset);
        }
    }
}

export default CodeBlockContent;
