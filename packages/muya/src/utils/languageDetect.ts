/**
 * Heuristic programming-language detection for untagged fenced code blocks.
 *
 * Deliberately conservative: the result is written into the block's info
 * string (and therefore into the user's file on save), so the detector only
 * answers when the code carries an unmistakable signature. Ambiguous input
 * returns null instead of the least-wrong guess.
 *
 * Returned names are the conventional fence identifiers (`bash`, `html`,
 * `dockerfile`, ...); Prism alias resolution maps them to grammar ids at
 * render time.
 */

// Below this size a snippet rarely carries a reliable signature (a shell
// one-liner is ~25 chars, a `fn main() {}` stub is 12).
const MIN_DETECT_LENGTH = 12;

// A pattern scoring 4 is a signature that cannot appear in any other listed
// language, so a single match already meets the confidence threshold.
const CONFIDENCE_THRESHOLD = 4;
// The winner must lead the runner-up by this much; ties stay untagged.
const CONFIDENCE_MARGIN = 2;

interface ILanguageRule {
    lang: string;
    // Boolean-matched patterns: each contributes its weight at most once.
    patterns: Array<[weight: number, pattern: RegExp]>;
}

const LANGUAGE_RULES: ILanguageRule[] = [
    {
        lang: 'bash',
        patterns: [
            [4, /^\s*(?:export|readonly)\s+(?:-\w+\s+)*\w+=[^\n]*$/m],
            [3, /^#!.*\b(?:ba)?sh\b/],
            [3, /(?:^|[;&|]\s*)(?:sudo|apt(?:-get)?|yum|dnf|pacman)\s+\w/m],
            [2, /\b(?:echo|grep|awk|sed|curl|wget|mkdir|chmod|chown|tar|rsync|source)\b/],
            [2, /\$\{?\w+\}?/],
            [2, /(?:^|\n)\s*(?:if|for|while)\b[^\n]+\b(?:then|do|fi|done)\b/],
            [1, /&&|\|\||\|\s*\w/],
        ],
    },
    {
        lang: 'powershell',
        patterns: [
            [4, /\bWrite-(?:Host|Output|Verbose|Warning)\b/],
            [3, /\b(?:Get|Set|New|Test|Remove|Clear)-\w+\b/],
            [2, /\$\w+\s*=\s*/],
            [2, /\bparam\s*\(/],
        ],
    },
    {
        lang: 'javascript',
        patterns: [
            [4, /console\.(?:log|error|warn|info|debug)\s*\(/],
            [3, /module\.exports/],
            [3, /\brequire\s*\(\s*['"]\w/],
            [2, /\b(?:const|let|var)\s+\w+/],
            [2, /\bfunction\s+\w+\s*\(/],
            [1, /=>/],
        ],
    },
    {
        // Rules are scored before javascript; when typescript matches at all
        // and at least ties, javascript is dropped (see _resolveRivalries).
        lang: 'typescript',
        patterns: [
            [4, /:\s*(?:string|number|boolean|void|any|unknown|never)\b/],
            [4, /\binterface\s+\w+\s*\{/],
            [3, /\b(?:enum|namespace|implements|readonly|abstract)\b/],
            [2, /\btype\s+\w+\s*=/],
            [1, /<[A-Z]\w*(?:,\s*\w+)?>/],
        ],
    },
    {
        lang: 'python',
        patterns: [
            [4, /^\s*def\s+\w+\s*\([^)]*\)\s*:\s*$/m],
            [3, /^\s*(?:import\s+\w+|from\s+\w+(?:\.\w+)*\s+import)\b/m],
            [2, /\b(?:elif|self|None|True|False)\b/],
            [2, /\bprint\s*\(/],
            [1, /^\s{4,}\S/m],
        ],
    },
    {
        lang: 'yaml',
        patterns: [
            [3, /(?:^|\n)---\s*(?:\n|$)/],
            [2, /^\w[\w.-]*:\s*(?:\S|$)/m],
            [2, /^[ \t]*-[ \t]+\S/m],
        ],
    },
    {
        lang: 'toml',
        patterns: [
            [3, /^\[[\w.$-]+\]\s*$/m],
            [2, /^\w[\w.-]*\s*=\s*(?:"[^"]*"|'[^']*'|\d+(?:\.\d+)?|true|false)\s*$/m],
        ],
    },
    {
        lang: 'ini',
        patterns: [
            [3, /^\[[^\]"\s]+\]\s*$/m],
            [1, /^\s*;\s/m],
        ],
    },
    {
        lang: 'html',
        patterns: [
            [4, /<!DOCTYPE\s+html/i],
            [2, /<(?:html|head|body|div|span|p|a|table|ul|ol|li|h[1-6]|section|header|footer)\b[^>]*>/i],
            [2, /\b(?:class|id|href|src|style)\s*=\s*["'][^"']*["']/i],
        ],
    },
    {
        lang: 'xml',
        patterns: [
            [4, /<\?xml\s/i],
            [3, /\bxmlns(?::\w+)?\s*=\s*["']/],
            [1, /<\/[a-z][\w.:-]*>/i],
        ],
    },
    {
        lang: 'css',
        patterns: [
            [4, /@(?:media|import|keyframes|font-face|supports)\b/],
            [3, /[.#][\w-][^{};]*\{[^{}:]*:[^{};]+;/],
            [1, /[a-z-]+\s*:\s*(?:#[0-9a-fA-F]{3,8}|\d+(?:px|em|rem|%|vh|vw))/],
        ],
    },
    {
        lang: 'c',
        patterns: [
            [3, /#\s*include\s*<[\w./]+\.h>/],
            [2, /\bint\s+main\s*\(/],
            [2, /\b(?:printf|scanf|malloc|free|memcpy)\s*\(/],
        ],
    },
    {
        // Scored before c; when cpp matches and at least ties, c is dropped.
        lang: 'cpp',
        patterns: [
            [4, /\bstd::\w+/],
            [3, /#\s*include\s*<(?![\w./]+\.h>)/],
            [2, /\b(?:cout|cin|cerr|endl)\b/],
            [2, /\b(?:namespace|template\s*<)\s*\w+/],
        ],
    },
    {
        lang: 'java',
        patterns: [
            [4, /\bpublic\s+(?:final\s+)?(?:class|enum)\s+\w+/],
            [4, /System\.(?:out|err)\.print/],
            [3, /\bpublic\s+interface\s+\w+/],
            [2, /\bpublic\s+static\s+(?:void|class|int)\b/],
            [2, /\bprivate\s+(?:final\s+)?\w+\s+\w+\s*[;=]/],
        ],
    },
    {
        lang: 'csharp',
        patterns: [
            [4, /\busing\s+System/],
            [3, /\bnamespace\s+\w+/],
            [3, /Console\.\w+\s*\(/],
            [2, /\bpublic\s+(?:void|string|int|class)\b/],
        ],
    },
    {
        lang: 'go',
        patterns: [
            [4, /^\s*package\s+\w+\s*$/m],
            [3, /\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/],
            [2, /\bfmt\.\w+\s*\(/],
            [2, /:=/],
        ],
    },
    {
        lang: 'rust',
        patterns: [
            [4, /\bfn\s+\w+\s*\(/],
            [3, /\b(?:let\s+mut|impl\s+\w+|unsafe\s+fn)\b/],
            [2, /(?:println|vec|format|panic)!\s*[([]/],
            [2, /\bmatch\s+\w+\s*\{/],
        ],
    },
    {
        lang: 'ruby',
        patterns: [
            [4, /\battr_(?:accessor|reader|writer)\b/],
            [4, /\brequire(?:_relative)?\s+['"]/],
            [3, /\bputs\s+["']/],
            [2, /^\s*def\s+[\w?!.]+(?:\([^)]*\))?\s*$/m],
        ],
    },
    {
        lang: 'php',
        patterns: [
            [4, /<\?php/],
            [3, /->\w+\s*\(/],
            [2, /\$\w+\s*=\s*/],
            [2, /\bfunction\s+\w+\s*\(/],
            [1, /\becho\s+["']/],
        ],
    },
    {
        lang: 'sql',
        patterns: [
            [3, /\bSELECT\b[^;]+\bFROM\b/i],
            [3, /\b(?:INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i],
            [2, /\b(?:WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING)\b/i],
        ],
    },
    {
        lang: 'lua',
        patterns: [
            [4, /\blocal\s+function\b/],
            [3, /\bfunction\s+[\w.:]+\s*\([^)]*\)\n(?![ \t]*\{)/],
            [2, /\blocal\s+\w+\s*=/],
            [2, /\b(?:ipairs|nil)\b/],
        ],
    },
    {
        lang: 'perl',
        patterns: [
            [4, /\bmy\s+\$\w+/],
            [3, /\buse\s+(?:strict|warnings)\b/],
            [2, /->\{?\$\w+/],
        ],
    },
    {
        lang: 'dockerfile',
        patterns: [
            [4, /^\s*FROM\s+\S+/m],
            [2, /^\s*(?:RUN|CMD|COPY|ADD|ENTRYPOINT|WORKDIR|EXPOSE)\s+\S+/m],
        ],
    },
    {
        lang: 'makefile',
        patterns: [
            [3, /^[^\t\n#][^\n:=]*:[^\n]*\n\t/m],
            [2, /\$\(\w+\)/],
            [1, /^\t[^\n]+$/m],
        ],
    },
    {
        lang: 'diff',
        patterns: [
            [4, /^(?:--- a\/|\+\+\+ b\/|diff --git)/m],
            [2, /^@@\s+-\d+(?:,\d+)?\s+\+\d+/m],
            [1, /^[+-][^\n+-]/m],
        ],
    },
];

// [specific, rival]: when specific matches and at least ties the rival, the
// rival is excluded before ranking. Typescript extends javascript and C++
// extends c, so their shared syntax must not elect the base language.
const LANGUAGE_RIVALRIES: Array<[specific: string, rival: string]> = [
    ['typescript', 'javascript'],
    ['cpp', 'c'],
];

// `env` indirections and common script paths resolve to the fence identifier.
const SHEBANG_INTERPRETERS: Record<string, string> = {
    sh: 'bash',
    bash: 'bash',
    ash: 'bash',
    dash: 'bash',
    zsh: 'bash',
    ksh: 'bash',
    python: 'python',
    python3: 'python',
    node: 'javascript',
    deno: 'javascript',
    ruby: 'ruby',
    perl: 'perl',
    php: 'php',
    pwsh: 'powershell',
    powershell: 'powershell',
    lua: 'lua',
};

function detectByShebang(code: string): string | null {
    const match = /^#!\s*(?:\/\S*\/)?(?:env\s+(?:-\S+\s+)*)?([\w.-]+)/.exec(code);
    if (!match)
        return null;

    return SHEBANG_INTERPRETERS[match[1].toLowerCase()] ?? null;
}

function looksLikeJson(code: string): boolean {
    const trimmed = code.trim();
    if (!/^[[{]/.test(trimmed) || !/[\]}]$/.test(trimmed))
        return false;

    try {
        JSON.parse(trimmed);
        return true;
    }
    catch {
        return false;
    }
}

function resolveRivalries(scores: Map<string, number>): Map<string, number> {
    const resolved = new Map(scores);
    for (const [specific, rival] of LANGUAGE_RIVALRIES) {
        const specificScore = resolved.get(specific) ?? 0;
        const rivalScore = resolved.get(rival) ?? 0;
        if (specificScore > 0 && specificScore >= rivalScore)
            resolved.delete(rival);
    }

    return resolved;
}

/**
 * Detect the language of a code snippet, or null when the input is too short,
 * ambiguous, or carries no listed signature.
 */
export function detectLanguage(code: string): string | null {
    const trimmed = code.trim();
    if (trimmed.length < MIN_DETECT_LENGTH)
        return null;

    const shebangLang = detectByShebang(code);
    if (shebangLang)
        return shebangLang;

    if (looksLikeJson(trimmed))
        return 'json';

    const scores = new Map<string, number>();
    for (const { lang, patterns } of LANGUAGE_RULES) {
        let score = 0;
        for (const [weight, pattern] of patterns) {
            if (pattern.test(code))
                score += weight;
        }
        if (score > 0)
            scores.set(lang, score);
    }

    const ranked = [...resolveRivalries(scores).entries()]
        .sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0)
        return null;

    const [bestLang, bestScore] = ranked[0];
    const runnerUpScore = ranked[1]?.[1] ?? 0;
    if (bestScore < CONFIDENCE_THRESHOLD || bestScore - runnerUpScore < CONFIDENCE_MARGIN)
        return null;

    return bestLang;
}
