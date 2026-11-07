import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import type { IPreviewDiagramPayload } from '../../../ui/previewToolBar';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { finalizeRenderedDiagram, renderDiagram } from '../../../utils/diagram/render';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import {
    applyCanvasSize,
    attachDiagramCanvasControls,
    CANVAS_MARKER_RE,
    formatCanvasMarker,
    measureMermaidSvg,
    parseCanvasMarker,
} from './diagramCanvasControls';

const debug = logger('diagramPreview:');

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _rendered = false;
    private _cancelFinalize: (() => void) | null = null;
    private _detachCanvasControls: (() => void) | null = null;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        // Fork: `mermaid` marks the previews that get canvas controls.
        this.classList = ['mu-diagram-preview'];
        if (meta.type === 'mermaid')
            this.classList.push('mermaid');
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));
    }

    /**
     * Fork: write the `%%{canvas:WxH}` marker back into the diagram code block
     * (first line). Mutates the code content via its `text` setter so the
     * change flows through the v2 transaction/state pipeline.
     */
    private _writeCanvasMarker(width: number, height: number) {
        const diagramBlock = this.parent;
        if (!diagramBlock) return;
        const codeContent = diagramBlock.firstContentInDescendant();
        if (!codeContent || typeof codeContent.text !== 'string') return;
        if (!this.muya.canMutate) return;

        const marker = formatCanvasMarker(width, height);
        const lines = codeContent.text.split('\n');
        if (lines.length && CANVAS_MARKER_RE.test(lines[0]!.trim())) {
            if (lines[0]!.trim() === marker) return;
            lines[0] = marker;
        }
        else {
            lines.unshift(marker);
        }
        codeContent.text = lines.join('\n');
    }

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        // Clicking the canvas must never jump into the code — editing goes
        // through the hover toolbar's edit button. In read-only mode the
        // click opens the diagram viewer instead.
        if (this.muya.isReadOnly) {
            if (this._rendered) {
                this.muya.eventCenter.emit('preview-diagram', {
                    type: this._type,
                    code: this._code,
                    preview: this.domNode!,
                    label: this.domNode!.getAttribute('aria-label'),
                } satisfies IPreviewDiagramPayload);
            }
        }
    }

    async update(code = this._code) {
        const { i18n } = this.muya;
        this._rendered = false;
        if (this._code !== code)
            this._code = code;

        // A previous render may still be waiting for its `<svg>`; it must not
        // describe whatever this one puts in its place.
        this._cancelFinalize?.();
        this._cancelFinalize = null;
        this._detachCanvasControls?.();
        this._detachCanvasControls = null;
        this.domNode!.removeAttribute('role');
        this.domNode!.removeAttribute('aria-label');

        if (code) {
            this.domNode!.innerHTML = i18n.t('Loading...');
            const { mermaidTheme, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
            const { _type: type } = this;
            const { width: markerWidth, height: markerHeight, cleanCode } = parseCanvasMarker(code);

            try {
                await renderDiagram({
                    target: this.domNode!,
                    // Fork: the leading `%%{canvas:WxH}` marker is a size hint,
                    // not diagram syntax — keep it away from the renderer.
                    code: type === 'mermaid' ? cleanCode : code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                });
                this._rendered = true;
                this._cancelFinalize = finalizeRenderedDiagram(this.domNode!, i18n.t('Diagram'));

                // Fork: auto canvas sizing + zoom/pan/resize controls. Canvas
                // markers are a mermaid convention; plantuml gets controls only.
                if (type === 'mermaid') {
                    const autoSize = measureMermaidSvg(this.domNode!);
                    const hasMarker = markerWidth != null && markerHeight != null;
                    const canvasWidth = hasMarker ? markerWidth : autoSize.width;
                    const canvasHeight = hasMarker ? markerHeight : autoSize.height;
                    if (canvasWidth > 0 && canvasHeight > 0) {
                        applyCanvasSize(this.domNode!, canvasWidth, canvasHeight);
                        if (!hasMarker) {
                            this._writeCanvasMarker(canvasWidth, canvasHeight);
                        }
                    }
                }
                if (type === 'mermaid' || type === 'plantuml') {
                    // Canvas markers persist only for mermaid (v1 parity).
                    this._detachCanvasControls = attachDiagramCanvasControls(this.domNode!, {
                        onCanvasResize:
                            type === 'mermaid'
                                ? (width, height) => this._writeCanvasMarker(width, height)
                                : undefined,
                    });
                }
            }
            catch (error) {
                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }
}

export default DiagramPreview;
