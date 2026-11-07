// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// Editing an untagged fenced block must fill its language through the same
// transaction path a manual pick uses, while a language the user deliberately
// cleared (or one already present) is never refilled.

interface IContentBlock {
    domNode: HTMLElement;
    text: string;
    blockName: string;
    setCursor: (startOffset: number, endOffset: number, overWrapping?: boolean) => void;
}

interface ILangInputBlock {
    domNode: HTMLElement;
    text: string;
    blockName: string;
    inputHandler: () => void;
}

const bootedHosts: HTMLElement[] = [];

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
});

function boot(markdown: string, autoDetect = true): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, codeBlockAutoDetectLanguage: autoDetect });
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function setCaretIn(domNode: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(domNode);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
}

function blocksOf(muya: Muya): { codeContent: IContentBlock; langInput: ILangInputBlock } {
    const codeBlock = muya.editor.scrollPage!.firstChild as unknown as {
        blockName: string;
        firstContentInDescendant: () => ILangInputBlock;
        lastContentInDescendant: () => IContentBlock;
    };
    expect(codeBlock.blockName).toBe('code-block');

    const langInput = codeBlock.firstContentInDescendant();
    const codeContent = codeBlock.lastContentInDescendant();
    expect(langInput.blockName).toBe('language-input');
    expect(codeContent.blockName).toBe('codeblock.content');

    return { codeContent, langInput };
}

async function waitForDetection(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 700));
}

// Editing reaches update() (and therefore the detection hook) the way the
// real flows do: a text change followed by setCursor, which is how both
// inputHandler and the paste paths re-render a code content block.
function editCodeContent(codeContent: IContentBlock, text: string): void {
    setCaretIn(codeContent.domNode);
    codeContent.text = text;
    codeContent.setCursor(text.length, text.length, true);
}

const SHELL_CODE = 'export abc=aaa; echo $abc';

describe('code block content — language auto-detection on edit', () => {
    it('fills the language after the content settles in an untagged block', async () => {
        const muya = boot('```\nplaceholder\n```\n');
        const { codeContent, langInput } = blocksOf(muya);

        editCodeContent(codeContent, SHELL_CODE);
        await waitForDetection();
        muya.editor.transactions.flush();

        expect(langInput.text).toBe('bash');
        expect(muya.getMarkdown().split('\n')[0]).toBe('```bash');
    });

    it('does not refill a language the user deliberately cleared', async () => {
        const muya = boot('```\nplaceholder\n```\n');
        const { codeContent, langInput } = blocksOf(muya);

        // First edit detects bash as above.
        editCodeContent(codeContent, SHELL_CODE);
        await waitForDetection();
        muya.editor.transactions.flush();
        expect(langInput.text).toBe('bash');

        // Clearing the language input marks the block; the next code edit
        // must not bring the language back.
        setCaretIn(langInput.domNode);
        langInput.domNode.textContent = '';
        langInput.inputHandler();
        muya.editor.transactions.flush();
        expect(langInput.text).toBe('');

        editCodeContent(codeContent, `${SHELL_CODE}\ncd /tmp`);
        await waitForDetection();
        muya.editor.transactions.flush();

        expect(langInput.text).toBe('');
        expect(muya.getMarkdown().split('\n')[0]).toBe('```');
    });

    it('stays untouched when the option is off', async () => {
        const muya = boot('```\nplaceholder\n```\n', false);
        const { codeContent, langInput } = blocksOf(muya);

        editCodeContent(codeContent, SHELL_CODE);
        await waitForDetection();
        muya.editor.transactions.flush();

        expect(langInput.text).toBe('');
        expect(muya.getMarkdown().split('\n')[0]).toBe('```');
    });
});
