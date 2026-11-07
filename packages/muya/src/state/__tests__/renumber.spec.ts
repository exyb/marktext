// @vitest-environment happy-dom

import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { MarkdownToState } from '../markdownToState';
import { renumberHeadingStates, renumberOrderedListStates } from '../renumber';
import ExportMarkdown from '../stateToMarkdown';

function parse(markdown: string, options: { fancyLists?: boolean } = {}): TState[] {
    return new MarkdownToState({
        footnote: false,
        texMathDollars: true,
        texMathGfm: false,
        texMathSingleBackslash: false,
        texMathDoubleBackslash: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        codeBlockAutoDetectLanguage: false,
        frontMatter: false,
        ...options,
    }).generate(markdown);
}

function write(states: TState[]): string {
    return new ExportMarkdown({ listIndentation: 1 }).generate(states as never);
}

function renumberHeadings(markdown: string): string {
    return write(renumberHeadingStates(parse(markdown)));
}

function renumberLists(markdown: string, options: { fancyLists?: boolean } = {}): string {
    return write(renumberOrderedListStates(parse(markdown, options)));
}

describe('renumberHeadingStates', () => {
    it('numbers headings from their levels, restarting deeper counters', () => {
        expect(renumberHeadings('# 概述\n\n## 安装\n\n### 配置\n\n# 进阶\n')).toBe(
            '# 1. 概述\n\n## 1.1 安装\n\n### 1.1.1 配置\n\n# 2. 进阶\n',
        );
    });

    it('strips authored numbers and renumbers in document order', () => {
        expect(renumberHeadings('# 1. 概述\n\n## 2.3 安装\n\n## 4.10 部署\n')).toBe(
            '# 1. 概述\n\n## 1.1 安装\n\n## 1.2 部署\n',
        );
    });

    it('collapses a skipped level in the number without rewriting heading levels', () => {
        expect(renumberHeadings('# A\n\n### B\n')).toBe('# 1. A\n\n### 1.1 B\n');
    });

    it('keeps digit runs that are not numbering (prose dates)', () => {
        expect(renumberHeadings('# 1984年大事记\n')).toBe('# 1. 1984年大事记\n');
    });

    it('renumbers setext headings and preserves the underline', () => {
        expect(renumberHeadings('标题\n===\n\n小节\n---\n')).toBe('1. 标题\n===\n\n1.1 小节\n---\n');
    });

    it('re-appends CommonMark closing hashes', () => {
        expect(renumberHeadings('# 概述 #\n')).toBe('# 1. 概述 #\n');
    });

    it('is idempotent', () => {
        const once = renumberHeadings('# 3. 概述\n\n## 9 安装\n');
        expect(renumberHeadings(once)).toBe(once);
    });

    it('returns the input reference when nothing changes', () => {
        const states = parse('# 1. 概述\n');
        expect(renumberHeadingStates(states)).toBe(states);
    });
});

describe('renumberOrderedListStates', () => {
    it('restarts ordered lists at 1 while keeping the delimiter', () => {
        expect(renumberLists('3) 第一\n4) 第二\n')).toBe('1) 第一\n2) 第二\n');
    });

    it('rewrites fancy markers sequentially in their own style', () => {
        expect(renumberLists('ix. 九\nx. 十\n', { fancyLists: true })).toBe('i. 九\nii. 十\n');
    });

    it('renumbers nested ordered lists independently', () => {
        expect(renumberLists('1. a\n   5. x\n2. b\n')).toBe('1. a\n   1. x\n2. b\n');
    });

    it('renumbers an ordered list nested in a bullet item', () => {
        expect(renumberLists('- a\n  7. x\n')).toBe('- a\n  1. x\n');
    });

    it('renumbers ordered task lists', () => {
        expect(renumberLists('3. [ ] 甲\n4. [x] 乙\n')).toBe('1. [ ] 甲\n2. [x] 乙\n');
    });

    it('leaves bullet lists alone', () => {
        const markdown = '- a\n- b\n';
        expect(renumberLists(markdown)).toBe(markdown);
    });

    it('returns the input reference when every list is already sequential', () => {
        const states = parse('1. a\n2. b\n');
        expect(renumberOrderedListStates(states)).toBe(states);
    });
});

describe('muya.renumberHeadings (behavior)', () => {
    it('rewrites the live document in one replace', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: '# 概述\n\n## 安装\n' });
        muya.init();

        expect(muya.renumberHeadings()).toBe(true);
        expect(muya.getMarkdown()).toBe('# 1. 概述\n\n## 1.1 安装\n');

        // Already numbered: the replace op is empty and reports no change.
        expect(muya.renumberHeadings()).toBe(false);
        expect(muya.getMarkdown()).toBe('# 1. 概述\n\n## 1.1 安装\n');
        host.remove();
    });
});
