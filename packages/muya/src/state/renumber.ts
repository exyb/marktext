import type { TState } from './types';
import { deepClone } from '../utils';
import { parseListMarker } from '../utils/listMarker';
import { atxHeadingBody, atxHeadingPrefixLength } from './headings';

/**
 * Document-wide renumbering, expressed as pure state → state transforms.
 * Callers feed the result to `muya.replaceContent`, which yields a single
 * undoable transaction; both functions return the input unchanged (same
 * reference) when there is nothing to fix, so callers can no-op cheaply.
 */

// Leading section number in a heading body, e.g. "1.2 安装" or "3、概述". A
// digit run followed by a non-separator ("1984年") is prose, not numbering.
const LEADING_NUMBER_RE = /^\d+(?:\.\d+)*[.、:：\t ][ \t]*/;

// CommonMark closing sequence ("## Title ##"); the lexer drops it, so it is
// re-appended to keep the round trip verbatim.
const CLOSING_HASHES_RE = /[ \t]+#+[ \t]*$/;

function stripLeadingNumber(body: string): string {
    return body.replace(LEADING_NUMBER_RE, '');
}

export function renumberHeadingStates(states: TState[]): TState[] {
    const cloned = deepClone(states);
    const counters: number[] = [];
    let previousLevel = 0;
    let changed = false;

    for (const state of cloned) {
        if (state.name !== 'atx-heading' && state.name !== 'setext-heading')
            continue;

        // Skipped levels collapse: the first heading is a top level, and a
        // deeper jump nests under the previous heading instead of leaving a 0.
        const effective = previousLevel === 0 ? 1 : Math.min(state.meta.level, previousLevel + 1);
        counters[effective - 1] = (counters[effective - 1] ?? 0) + 1;
        counters.length = effective;
        previousLevel = effective;

        const number = counters.join('.');
        const separator = effective === 1 ? '. ' : ' ';

        if (state.name === 'atx-heading') {
            const prefix = state.text.slice(0, atxHeadingPrefixLength(state.text));
            const closing = CLOSING_HASHES_RE.exec(state.text)?.[0] ?? '';
            const body = stripLeadingNumber(atxHeadingBody(state.text)).trimEnd();
            const next = `${prefix}${number}${separator}${body}${closing}`;
            if (next !== state.text) {
                state.text = next;
                changed = true;
            }
        }
        else {
            const body = stripLeadingNumber(state.text).trimEnd();
            const next = `${number}${separator}${body}`;
            if (next !== state.text) {
                state.text = next;
                changed = true;
            }
        }
    }

    return changed ? cloned : states;
}

export function renumberOrderedListStates(states: TState[]): TState[] {
    const cloned = deepClone(states);
    let changed = false;

    // Authored markers that already spell the sequential sequence (1. 2. … in
    // the list's own style) are emitted verbatim by the writer, so a list is
    // left untouched when its markers already run 1, 2, … from its start.
    const markersAreSequential = (
        markers: string[],
        itemCount: number,
        style: string | undefined,
        delimiter: string,
    ): boolean => {
        return markers.length === itemCount
            && markers.every((marker, i) => {
                const parsed = parseListMarker(marker, style as never);
                return !!parsed
                    && parsed.value === i + 1
                    && parsed.delimiter === delimiter
                    && (parsed.style ?? 'decimal') === (style ?? 'decimal');
            });
    };
    const renumberListMeta = (
        meta: { start?: number; sourceMarkers?: string[] },
        itemCount: number,
        style: string | undefined,
        delimiter: string,
    ): boolean => {
        if (
            meta.start === 1
            && !!meta.sourceMarkers
            && markersAreSequential(meta.sourceMarkers, itemCount, style, delimiter)
        ) {
            return true;
        }

        if (meta.start !== 1 || meta.sourceMarkers !== undefined) {
            meta.start = 1;
            changed = true;
        }
        if (meta.sourceMarkers !== undefined) {
            delete meta.sourceMarkers;
            changed = true;
        }

        return false;
    };
    const walk = (state: TState): void => {
        switch (state.name) {
            case 'order-list': {
                const sequential = renumberListMeta(state.meta, state.children.length, state.meta.style, state.meta.delimiter);
                for (const item of state.children) {
                    if (!sequential && item.meta?.orderMarker !== undefined) {
                        delete item.meta.orderMarker;
                        changed = true;
                    }
                    for (const child of item.children)
                        walk(child);
                }
                break;
            }
            case 'task-list': {
                const meta = state.meta;
                const sequential = meta.ordered
                    ? renumberListMeta(meta, state.children.length, meta.style, meta.delimiter)
                    : true;
                for (const item of state.children) {
                    if (!sequential && item.meta?.orderMarker !== undefined) {
                        delete item.meta.orderMarker;
                        changed = true;
                    }
                    for (const child of item.children)
                        walk(child);
                }
                break;
            }
            case 'bullet-list': {
                for (const item of state.children) {
                    for (const child of item.children)
                        walk(child);
                }
                break;
            }
            default:
                break;
        }
    };

    for (const state of cloned)
        walk(state);

    return changed ? cloned : states;
}
