import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IAnchorFocusInfo, ITextSelectionState } from '../selection/types';
import { isOsx } from '../config';
import { findContentDOM, resolveEndpoint } from '../selection/dom';
import { createTextSelectionState } from '../selection/state';
import { SelectionDirection, SelectionType } from '../selection/types';
import { atxHeadingBodyRange } from '../state/headings';

const TEXT_BLOCKS = new Set([
    'paragraph.content',
    'atxheading.content',
    'setextheading.content',
    'table.cell.content',
    'codeblock.content',
]);

export interface ITextDragSource {
    block: Content;
    start: number;
    end: number;
    original: string;
    selection: ITextSelectionState;
    // Full selected text: equals `original.slice(start, end)` for same-block
    // sources; for cross-block sources it spans blocks and `endBlock` is set.
    text: string;
    endBlock: Content | null;
    endOffset: number;
}

function validOffset(block: Content, offset: number): boolean {
    if (!TEXT_BLOCKS.has(block.blockName) || !Number.isInteger(offset) || offset < 0 || offset > block.text.length)
        return false;
    const previous = block.text.charCodeAt(offset - 1);
    const next = block.text.charCodeAt(offset);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF)
        return false;
    return true;
}

export function getTextDragSource(muya: Muya): ITextDragSource | null {
    const selection = muya.getSelection();
    if (muya.isReadOnly || muya.editor.isComposing || selection?.kind !== SelectionType.TEXT)
        return null;
    const { anchorBlock, focusBlock, isCollapsed, direction } = selection.context;
    if (isCollapsed)
        return null;
    if (anchorBlock === focusBlock) {
        const start = Math.min(selection.anchor.offset, selection.focus.offset);
        const end = Math.max(selection.anchor.offset, selection.focus.offset);
        if (!validOffset(anchorBlock, start) || !validOffset(anchorBlock, end))
            return null;
        return {
            block: anchorBlock,
            start,
            end,
            original: anchorBlock.text,
            text: anchorBlock.text.slice(start, end),
            endBlock: null,
            endOffset: end,
            selection: createTextSelectionState(
                { block: anchorBlock, offset: selection.anchor.offset, path: anchorBlock.path },
                { block: focusBlock, offset: selection.focus.offset, path: focusBlock.path },
            ),
        };
    }
    // Cross-block selections drag as copy-only sources: removal would span
    // block boundaries, so only outside drops (host quoting) consume them.
    const [startBlock, endBlock] = direction === SelectionDirection.BACKWARD
        ? [focusBlock, anchorBlock]
        : [anchorBlock, focusBlock];
    if (!muya.isBlockInDocument(startBlock) || !muya.isBlockInDocument(endBlock))
        return null;
    const startOffset = startBlock === anchorBlock ? selection.anchor.offset : selection.focus.offset;
    const endOffset = endBlock === focusBlock ? selection.focus.offset : selection.anchor.offset;
    if (!validOffset(startBlock, startOffset) || !validOffset(endBlock, endOffset))
        return null;
    const text = muya.getSelectedText();
    if (!text)
        return null;
    return {
        block: startBlock,
        start: startOffset,
        end: startBlock.text.length,
        original: startBlock.text,
        text,
        endBlock,
        endOffset,
        selection: createTextSelectionState(
            { block: anchorBlock, offset: selection.anchor.offset, path: anchorBlock.path },
            { block: focusBlock, offset: selection.focus.offset, path: focusBlock.path },
        ),
    };
}

export function canDropText(muya: Muya, source: ITextDragSource, target: IAnchorFocusInfo, copy: boolean): boolean {
    if (muya.isReadOnly || muya.editor.isComposing || source.block.text !== source.original)
        return false;
    // Cross-block sources are quote-only and never drop inside the editor.
    if (source.endBlock)
        return false;
    if (!muya.isBlockInDocument(source.block) || !muya.isBlockInDocument(target.block) || !validOffset(target.block, target.offset))
        return false;
    if (target.block.blockName === 'atxheading.content') {
        const body = atxHeadingBodyRange(target.block.text);
        if (target.offset < body.start || target.offset > body.end)
            return false;
    }
    if (target.block === source.block) {
        return copy
            ? target.offset <= source.start || target.offset >= source.end
            : target.offset < source.start || target.offset > source.end;
    }
    return true;
}

function contentBlocks(muya: Muya): Content[] {
    const blocks: Content[] = [];
    let block = muya.editor.scrollPage!.firstContentInDescendant();
    while (block) {
        blocks.push(block);
        block = block.nextContentInContext() ?? null;
    }
    return blocks;
}

function bookmarkTarget(muya: Muya, source: Content, target: Content): () => Content {
    const blocks = contentBlocks(muya);
    const index = blocks.indexOf(target);
    const beforeSource = index < blocks.indexOf(source);
    const distanceFromEnd = blocks.length - index;
    const text = target.text;

    return () => {
        if (muya.isBlockInDocument(target))
            return target;
        // Conversions may split the source and rebuild its siblings, but retain
        // other leaves in order. Count from the end that does not cross the source.
        const current = contentBlocks(muya);
        const resolved = current[beforeSource ? index : current.length - distanceFromEnd];
        if (!resolved || resolved.text !== text || resolved.blockName !== target.blockName)
            throw new Error('Text drag destination lost during source conversion');
        return resolved;
    };
}

export function dropText(muya: Muya, source: ITextDragSource, target: IAnchorFocusInfo, copy: boolean): void {
    if (!canDropText(muya, source, target, copy))
        return;
    const { block, start, end, original, text } = source;
    const inserted = ['atxheading.content', 'table.cell.content'].includes(target.block.blockName)
        ? text.replace(/\r\n|[\r\n]/g, '<br>')
        : text;
    const offset = target.offset - (!copy && target.block === block && target.offset > end ? end - start : 0);

    muya.editor.transact(() => {
        let destination = target.block;
        if (!copy) {
            block.text = original.slice(0, start) + original.slice(end);
            block.update();
        }
        // Conversion handlers require a local cursor, even for the leaf losing the text.
        if (!copy && block !== destination && block.blockName !== 'codeblock.content') {
            const resolveTarget = bookmarkTarget(muya, block, destination);
            block.setCursor(start, start, true);
            (block as Format).checkInlineUpdate();
            destination = resolveTarget();
        }
        destination.text = destination.text.slice(0, offset) + inserted + destination.text.slice(offset);
        destination.setCursor(offset, offset + inserted.length, true);
        if (destination.blockName !== 'codeblock.content')
            (destination as Format).checkInlineUpdate();
    }, true, source.selection);
}

interface IPointTarget {
    endpoint: IAnchorFocusInfo;
    rect: DOMRect;
}

function targetAt(muya: Muya, x: number, y: number): IPointTarget | null {
    const doc = muya.domNode.ownerDocument;
    const hit = doc.elementFromPoint(x, y);
    if (hit?.closest('img, input, textarea, button, [contenteditable="false"], .mu-math-render, .mu-ruby-render'))
        return null;
    const content = findContentDOM(hit);
    if (!content || !muya.domNode.contains(content))
        return null;
    const caret = doc.caretPositionFromPoint?.(x, y);
    const range = doc.createRange();
    if (caret) {
        range.setStart(caret.offsetNode, caret.offset);
        range.collapse(true);
    }
    else {
        const fallback = doc.caretRangeFromPoint?.(x, y);
        if (!fallback)
            return null;
        range.setStart(fallback.startContainer, fallback.startOffset);
        range.collapse(true);
    }
    const endpoint = resolveEndpoint(range.startContainer, range.startOffset);
    if (!endpoint || endpoint.block.domNode !== content)
        return null;
    const rect = range.getClientRects()[0] ?? content.getBoundingClientRect();
    return { endpoint, rect };
}

export class TextDrag {
    private _eventIds: string[] = [];
    private _source: ITextDragSource | null = null;
    private _origin = { x: 0, y: 0 };
    private _point = { x: 0, y: 0 };
    private _dragging = false;
    private _suppressClick = false;
    private _copy = false;
    private _cursor = '';
    private _scroll = { top: 0, left: 0 };
    private _preview: HTMLElement | null = null;
    private _indicator: HTMLElement | null = null;
    // A multi-click press (detail > 1) may become a drag of the selection the
    // editor just committed; the gesture adopts it from the first move.
    private _pending = false;
    private _pendingPoint = { x: 0, y: 0 };

    constructor(private _muya: Muya) {
        const { eventCenter, domNode } = _muya;
        const doc = domNode.ownerDocument;
        const attach = (target: HTMLElement | Document, name: string, handler: EventListener) => {
            const eventId = eventCenter.attachDOMEvent(target, name, handler, true);
            this._eventIds.push(eventId);
        };
        attach(doc, 'mousedown', this._down);
        attach(doc, 'mousemove', this._move);
        attach(doc, 'mouseup', this._up);
        attach(doc, 'keydown', this._key);
        attach(doc, 'keyup', this._key);
        attach(doc, 'blur', this._blur);
        attach(domNode, 'scroll', () => this._restoreScroll());
        doc.defaultView?.addEventListener('blur', this._blur);
        attach(doc, 'click', (event) => {
            if (this._suppressClick) {
                this._suppressClick = false;
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        });
        attach(domNode, 'dragstart', (event) => {
            // Native text drops bypass transactions and may also scroll the editor.
            if (findContentDOM(event.target as Node))
                event.preventDefault();
        });
        eventCenter.on('read-only-changed', this._readOnlyChanged);
        eventCenter.on('json-change', this._jsonChanged);
    }

    get isDragging(): boolean {
        return this._dragging;
    }

    destroy(): void {
        this.cancel(false);
        const { eventCenter, domNode } = this._muya;
        for (const eventId of this._eventIds)
            eventCenter.detachDOMEvent(eventId);
        this._eventIds = [];
        eventCenter.off('read-only-changed', this._readOnlyChanged);
        eventCenter.off('json-change', this._jsonChanged);
        domNode.ownerDocument.defaultView?.removeEventListener('blur', this._blur);
    }

    private _blur = () => this.cancel();
    private _readOnlyChanged = () => this.cancel();
    private _jsonChanged = () => this.cancel(false);

    cancel(restore = true): void {
        const source = this._source;
        if (!source)
            return;
        const wasDragging = this._dragging;
        this._source = null;
        this._dragging = false;
        this._pending = false;
        this._preview?.remove();
        this._indicator?.remove();
        this._preview = this._indicator = null;
        delete this._muya.domNode.dataset.textDragging;
        this._muya.domNode.style.cursor = this._cursor;
        this._muya.domNode.ownerDocument.documentElement.style.cursor = '';
        if (restore && source && source.block.text === source.original && this._muya.isBlockInDocument(source.block))
            this._muya.setSelection(source.selection);
        // Hosts track the drag through move events; they must see the end too.
        if (wasDragging)
            this._muya.eventCenter.emit('text-drag-end');
    }

    private _down = (event: Event) => {
        this._suppressClick = false;
        this.cancel(false);
        this._pending = false;
        if (!(event instanceof MouseEvent) || event.button !== 0 || event.shiftKey)
            return;
        if (!(event.target instanceof Node) || !this._muya.domNode.contains(event.target))
            return;
        if (event.detail > 1) {
            // Double/triple clicks still select through the editor's own
            // handlers; only a following move may turn the press into a drag.
            this._pending = true;
            this._pendingPoint = { x: event.clientX, y: event.clientY };
            return;
        }
        if (!this._adopt(getTextDragSource(this._muya), { x: event.clientX, y: event.clientY }))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    // Take ownership of a press on the current selection. Returns false when
    // the press is not a drag of selectable text and must stay a plain click.
    private _adopt(source: ITextDragSource | null, press: { x: number; y: number }): boolean {
        const native = document.getSelection();
        if (!source || !native?.rangeCount)
            return false;
        const inside = [...native.getRangeAt(0).getClientRects()].some(rect =>
            press.x >= rect.left && press.x <= rect.right
            && press.y >= rect.top && press.y <= rect.bottom,
        );
        if (!inside)
            return false;
        // The DOM selection must still be the source one; either endpoint
        // matches because backward selections anchor at the focus block.
        const anchorContent = findContentDOM(native.anchorNode);
        if (anchorContent !== source.block.domNode && anchorContent !== source.endBlock?.domNode)
            return false;
        this._scroll = { top: this._muya.domNode.scrollTop, left: this._muya.domNode.scrollLeft };
        this._muya.flush();
        this._source = source;
        this._restoreScroll();
        this._origin = this._point = press;
        this._cursor = this._muya.domNode.style.cursor;
        return true;
    }

    // Native mouse-drag sources can omit buttons; the captured down/up events own the gesture.
    private _move = (event: Event) => {
        if (!(event instanceof MouseEvent))
            return;
        if (this._pending) {
            if (!(event.buttons & 1)) {
                this._pending = false;
                return;
            }
            if (Math.hypot(event.clientX - this._pendingPoint.x, event.clientY - this._pendingPoint.y) < 4)
                return;
            this._pending = false;
            const press = this._pendingPoint;
            if (!this._adopt(getTextDragSource(this._muya), press))
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this._point = { x: event.clientX, y: event.clientY };
            this._copy = isOsx ? event.altKey : event.ctrlKey;
            this._beginDrag();
            this._paint();
            return;
        }
        if (!this._source)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this._point = { x: event.clientX, y: event.clientY };
        this._copy = isOsx ? event.altKey : event.ctrlKey;
        if (!this._dragging && Math.hypot(event.clientX - this._origin.x, event.clientY - this._origin.y) < 4)
            return;
        if (!this._dragging)
            this._beginDrag();
        this._paint();
    };

    private _beginDrag(): void {
        if (!this._source)
            return;
        this._dragging = true;
        this._muya.domNode.dataset.textDragging = 'true';
        this._muya.hideAllFloatTools();
        this._preview = this._overlay('mu-text-drag-preview');
        this._preview.textContent = this._source.text.slice(0, 100);
        this._indicator = this._overlay('mu-text-drop-caret');
    }

    private _key = (event: Event) => {
        if (!this._source || !(event instanceof KeyboardEvent))
            return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this._suppressClick = true;
            this.cancel();
            return;
        }
        this._copy = isOsx ? event.altKey : event.ctrlKey;
        if (this._dragging)
            this._paint();
    };

    private _up = (event: Event) => {
        this._pending = false;
        if (!this._source || !(event instanceof MouseEvent) || event.button !== 0)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const source = this._source;
        this._restoreScroll();
        const target = targetAt(this._muya, event.clientX, event.clientY);
        const copy = isOsx ? event.altKey : event.ctrlKey;
        const dragging = this._dragging;
        this._suppressClick = dragging;
        this.cancel();
        if (dragging && target) {
            dropText(this._muya, source, target.endpoint, copy);
        }
        else if (!dragging && target) {
            target.endpoint.block.setCursor(target.endpoint.offset, target.endpoint.offset, true);
        }
        else if (dragging && !target) {
            // The gesture ended outside editable content: hand the text to the
            // host (e.g. an AI chat panel) instead of silently cancelling.
            // Outside drops stay copy-like; the source text is left intact.
            const blocks = this._muya.editor.scrollPage ? contentBlocks(this._muya) : [];
            this._muya.eventCenter.emit('text-drag-outside', {
                text: source.text,
                clientX: event.clientX,
                clientY: event.clientY,
                copy,
                range: {
                    startPath: [...source.block.path],
                    startOffset: source.start,
                    endPath: [...(source.endBlock ?? source.block).path],
                    endOffset: source.endBlock ? source.endOffset : source.end,
                    startBlockIndex: blocks.indexOf(source.block),
                    endBlockIndex: blocks.indexOf(source.endBlock ?? source.block),
                },
            });
        }
    };

    private _overlay(className: string): HTMLElement {
        const doc = this._muya.domNode.ownerDocument;
        const element = doc.createElement('div');
        element.className = className;
        element.contentEditable = 'false';
        element.setAttribute('aria-hidden', 'true');
        // The overlays position against the viewport, so they must live outside
        // the editor subtree: host containers use container-type/overflow that
        // turns them into the fixed-position containing block and clip them.
        doc.body.appendChild(element);
        return element;
    }

    // Host caret-follow animations must not move the document under a captured drop point.
    private _restoreScroll(): void {
        if (!this._source)
            return;
        const root = this._muya.domNode;
        if (root.scrollTop !== this._scroll.top)
            root.scrollTop = this._scroll.top;
        if (root.scrollLeft !== this._scroll.left)
            root.scrollLeft = this._scroll.left;
    }

    private _paint(): void {
        if (!this._source || !this._preview || !this._indicator)
            return;
        this._restoreScroll();
        const { x, y } = this._point;
        const target = targetAt(this._muya, x, y);
        const allowed = target && canDropText(this._muya, this._source, target.endpoint, this._copy);
        // Outside the editor entirely the host may still accept the drop, so
        // advertise copy rather than blocking with not-allowed. The document
        // cursor covers the area outside `domNode`, whose inline cursor still
        // rules inside the editor.
        const doc = this._muya.domNode.ownerDocument;
        doc.documentElement.style.cursor = !target ? 'copy' : '';
        this._muya.domNode.style.cursor = !target
            ? 'copy'
            : allowed
                ? (this._copy ? 'copy' : 'grabbing')
                : 'not-allowed';
        this._preview.dataset.operation = this._copy ? 'copy' : 'move';
        this._preview.style.left = `${x + 14}px`;
        this._preview.style.top = `${y + 14}px`;
        this._indicator.hidden = !allowed;
        if (allowed) {
            this._indicator.style.left = `${target.rect.left}px`;
            this._indicator.style.top = `${target.rect.top}px`;
            this._indicator.style.height = `${Math.max(target.rect.height, 16)}px`;
        }
        this._muya.eventCenter.emit('text-drag-move', { clientX: x, clientY: y });
    }
}
