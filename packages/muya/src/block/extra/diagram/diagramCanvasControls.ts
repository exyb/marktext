/**
 * Fork feature: diagram canvas controls, ported from the muya v1 fork's
 * StateRender (parser/render/index.js) onto the muya v2 DiagramPreview.
 *
 * Provides, per rendered diagram preview:
 * - a `%%{canvas:WxH}` first-line marker in the code block that pins the
 *   canvas size (auto-measured and written back on first render),
 * - a floating control bar (zoom in / out / reset),
 * - mouse-wheel zooming and drag-to-pan over the diagram,
 * - four drag-corner handles to resize the canvas.
 */

export const CANVAS_MARKER_RE = /^%%\{canvas:(\d+)x(\d+)\}\s*$/;

export const parseCanvasMarker = (code: string): { width: number | null; height: number | null; cleanCode: string } => {
    if (!code) return { width: null, height: null, cleanCode: code };
    const lines = code.split('\n');
    const match = lines[0]!.trim().match(CANVAS_MARKER_RE);
    if (match) {
        return {
            width: parseInt(match[1]!, 10),
            height: parseInt(match[2]!, 10),
            cleanCode: lines.slice(1).join('\n'),
        };
    }
    return { width: null, height: null, cleanCode: code };
};

export const stripCanvasMarker = (code: string): string => parseCanvasMarker(code).cleanCode;

export const formatCanvasMarker = (width: number, height: number): string =>
    `%%{canvas:${Math.round(width)}x${Math.round(height)}}`;

/**
 * Measure the natural size of the rendered SVG inside `target`
 * (used for the automatic canvas size).
 */
export const measureMermaidSvg = (target: HTMLElement): { width: number; height: number } => {
    const svg = target.querySelector('svg');
    if (!svg) return { width: 0, height: 0 };
    // Prefer the SVG width/height attributes (natural size set by mermaid).
    const attrWidth = parseFloat(svg.getAttribute('width') ?? '');
    const attrHeight = parseFloat(svg.getAttribute('height') ?? '');
    if (attrWidth > 0 && attrHeight > 0) {
        return { width: Math.round(attrWidth), height: Math.round(attrHeight) };
    }
    // Fall back to the rendered bounding box.
    try {
        const bbox = svg.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
            return { width: Math.round(bbox.width), height: Math.round(bbox.height) };
        }
    }
    catch {
        // getBBox throws in some situations (e.g. detached nodes).
    }
    return { width: 0, height: 0 };
};

/**
 * Apply the canvas size to the diagram container. The container sizes itself
 * via CSS `max-content` to the SVG's natural size; inline styles are only set
 * once the user resized the canvas by dragging.
 */
export const applyCanvasSize = (target: HTMLElement, width: number, height: number): void => {
    if (target.dataset.userResized === 'true') {
        target.style.width = `${width}px`;
        target.style.height = `${height}px`;
    }
    target.dataset.canvasWidth = String(width);
    target.dataset.canvasHeight = String(height);
};

interface IDiagramCanvasOptions {
    /** Called with the new canvas size when the user finished a corner drag. */
    onCanvasResize?: (width: number, height: number) => void;
}

/**
 * Attach zoom / pan / resize controls to a rendered diagram preview node.
 * Returns a cleanup function that detaches every listener.
 */
export const attachDiagramCanvasControls = (
    container: HTMLElement,
    options: IDiagramCanvasOptions = {},
): (() => void) => {
    const cleanups: Array<() => void> = [];
    const detach = () => {
        while (cleanups.length) {
            try {
                cleanups.pop()?.();
            }
            catch {
                // ignore teardown races
            }
        }
    };

    const scalableElement = (container.querySelector('svg') || container.querySelector('img')) as
        | SVGElement
        | HTMLElement
        | null;
    if (!scalableElement) return detach;

    // Control bar -------------------------------------------------------------
    const controls = document.createElement('div');
    controls.className = 'mu-diagram-controls';
    controls.innerHTML = `
        <button class="mu-diagram-btn mu-diagram-zoom-in" title="+" tabindex="-1">+</button>
        <button class="mu-diagram-btn mu-diagram-zoom-out" title="-" tabindex="-1">-</button>
        <button class="mu-diagram-btn mu-diagram-zoom-reset" title="\u27f2" tabindex="-1">\u27f2</button>
    `;
    controls.style.zIndex = '100';
    container.appendChild(controls);

    // Zoom / pan wrapper ------------------------------------------------------
    const wrapper = document.createElement('div');
    wrapper.className = 'mu-diagram-zoom-wrapper';
    wrapper.style.cssText = `
        position: relative;
        width: 100%;
        height: 100%;
        cursor: grab;
        overflow: visible;
        transition: none !important;
    `;
    scalableElement.style.position = 'relative';
    (scalableElement.style as CSSStyleDeclaration).zIndex = '1';
    container.insertBefore(wrapper, container.firstChild);
    wrapper.appendChild(scalableElement);

    // Four corner drag handles ------------------------------------------------
    const cornerConfigs = [
        { cls: 'resize-nw', cursor: 'nw-resize', h: -1, v: -1 },
        { cls: 'resize-ne', cursor: 'ne-resize', h: 1, v: -1 },
        { cls: 'resize-sw', cursor: 'sw-resize', h: -1, v: 1 },
        { cls: 'resize-se', cursor: 'se-resize', h: 1, v: 1 },
    ];
    const resizeHandles: HTMLElement[] = [];
    for (const cfg of cornerConfigs) {
        const handle = document.createElement('div');
        handle.className = `mu-diagram-resize-corner ${cfg.cls}`;
        handle.style.zIndex = '101';
        handle.dataset.h = String(cfg.h);
        handle.dataset.v = String(cfg.v);
        handle.style.cursor = cfg.cursor;
        container.appendChild(handle);
        resizeHandles.push(handle);
    }

    // Transform state ---------------------------------------------------------
    let scale = 1;
    let translateX = 0;
    let translateY = 0;

    const savedTransform = container.dataset.diagramTransform ?? null;
    if (savedTransform) {
        const translateMatch = savedTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
        const scaleMatch = savedTransform.match(/scale\(([^)]+)\)/);
        if (translateMatch) {
            translateX = parseFloat(translateMatch[1]!);
            translateY = parseFloat(translateMatch[2]!);
        }
        if (scaleMatch) {
            scale = parseFloat(scaleMatch[1]!);
        }
    }

    let rafId: number | null = null;
    const updateTransform = () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            const transformValue = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            scalableElement.style.transform = transformValue;
            scalableElement.style.transformOrigin = 'top left';
            container.dataset.diagramTransform = transformValue;
            if (scale !== 1 || translateX !== 0 || translateY !== 0) {
                container.classList.add('diagram-focused');
            }
            else {
                container.classList.remove('diagram-focused');
                delete container.dataset.diagramTransform;
            }
            rafId = null;
        });
    };

    const resetTransform = () => {
        scale = 1;
        translateX = 0;
        translateY = 0;
        updateTransform();
    };

    const onZoomIn = (event: Event) => {
        event.stopPropagation();
        scale = Math.min(scale * 1.2, 5);
        updateTransform();
    };
    const onZoomOut = (event: Event) => {
        event.stopPropagation();
        scale = Math.max(scale / 1.2, 0.2);
        updateTransform();
    };
    const onZoomReset = (event: Event) => {
        event.stopPropagation();
        resetTransform();
    };
    controls.querySelector('.mu-diagram-zoom-in')!.addEventListener('click', onZoomIn);
    controls.querySelector('.mu-diagram-zoom-out')!.addEventListener('click', onZoomOut);
    controls.querySelector('.mu-diagram-zoom-reset')!.addEventListener('click', onZoomReset);

    // Mouse wheel zooming ------------------------------------------------------
    const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey)
            return;
        event.preventDefault();
        event.stopPropagation();
        if (event.deltaY < 0)
            scale = Math.min(scale * 1.1, 5);
        else
            scale = Math.max(scale / 1.1, 0.2);
        updateTransform();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    cleanups.push(() => container.removeEventListener('wheel', onWheel));

    // Drag to pan --------------------------------------------------------------
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let dragMouseMove: ((event: MouseEvent) => void) | null = null;
    let dragMouseUp: ((event: MouseEvent) => void) | null = null;

    const onWrapperMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest('.mu-diagram-controls') || target.closest('.mu-diagram-resize-corner')) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        isDragging = true;
        startX = event.clientX - translateX;
        startY = event.clientY - translateY;
        wrapper.style.cursor = 'grabbing';

        dragMouseMove = (moveEvent: MouseEvent) => {
            if (!isDragging) return;
            translateX = moveEvent.clientX - startX;
            translateY = moveEvent.clientY - startY;
            updateTransform();
        };
        dragMouseUp = () => {
            isDragging = false;
            wrapper.style.cursor = 'grab';
            document.removeEventListener('mousemove', dragMouseMove!);
            document.removeEventListener('mouseup', dragMouseUp!);
        };
        document.addEventListener('mousemove', dragMouseMove);
        document.addEventListener('mouseup', dragMouseUp);
    };
    wrapper.addEventListener('mousedown', onWrapperMouseDown);
    cleanups.push(() => wrapper.removeEventListener('mousedown', onWrapperMouseDown));

    // Corner drag canvas resize -------------------------------------------------
    let activeResizeMove: ((event: MouseEvent) => void) | null = null;
    let activeResizeUp: (() => void) | null = null;

    for (const handle of resizeHandles) {
        const onClick = (event: Event) => event.stopPropagation();
        handle.addEventListener('click', onClick);

        const onMouseDown = (event: MouseEvent) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            if (activeResizeMove) {
                document.removeEventListener('mousemove', activeResizeMove);
                document.removeEventListener('mouseup', activeResizeUp!);
            }

            const h = parseInt(handle.dataset.h!, 10); // 1: right side, -1: left side
            const v = parseInt(handle.dataset.v!, 10); // 1: bottom, -1: top
            const startX = event.clientX;
            const startY = event.clientY;
            const startWidth = container.offsetWidth;
            const startHeight = container.offsetHeight;

            container.dataset.userResized = 'true';

            activeResizeMove = (moveEvent: MouseEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                const newWidth = Math.max(100, startWidth + dx * h);
                const newHeight = Math.max(75, startHeight + dy * v);
                container.style.width = `${newWidth}px`;
                container.style.height = `${newHeight}px`;
                container.dataset.canvasWidth = String(Math.round(newWidth));
                container.dataset.canvasHeight = String(Math.round(newHeight));
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
            };

            activeResizeUp = () => {
                document.removeEventListener('mousemove', activeResizeMove!);
                document.removeEventListener('mouseup', activeResizeUp!);
                activeResizeMove = null;
                activeResizeUp = null;
                const w = parseInt(container.dataset.canvasWidth ?? '0', 10);
                const hVal = parseInt(container.dataset.canvasHeight ?? '0', 10);
                if (w > 0 && hVal > 0) options.onCanvasResize?.(w, hVal);
            };

            document.addEventListener('mousemove', activeResizeMove);
            document.addEventListener('mouseup', activeResizeUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
    }

    // Double-click reset ---------------------------------------------------------
    const onDblClick = (event: Event) => {
        event.stopPropagation();
        resetTransform();
    };
    wrapper.addEventListener('dblclick', onDblClick);
    cleanups.push(() => wrapper.removeEventListener('dblclick', onDblClick));

    return detach;
};
