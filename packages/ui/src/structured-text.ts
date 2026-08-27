/**
 * Structured text detection and lightweight syntax tokenisation.
 *
 * Optik runs inside the inspected page, so pulling in a full editor/highlighter would
 * increase both the IIFE and the host page's runtime cost. These helpers deliberately
 * cover the formats that actually occur in network/storage/console payloads while
 * keeping every operation bounded and side-effect free.
 */

export type CodeLanguage =
  | 'json'
  | 'javascript'
  | 'html'
  | 'xml'
  | 'css'
  | 'shell'
  | 'form'
  | 'text';

export type SyntaxTokenKind =
  | 'plain'
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'keyword'
  | 'comment'
  | 'tag'
  | 'attr'
  | 'punctuation';

export interface SyntaxToken {
  text: string;
  kind: SyntaxTokenKind;
}

export interface JsonDocument {
  value: unknown;
  formatted: string;
}

/** Parsing beyond 1 MiB on the inspected page is no longer an interaction-sized task. */
export const JSON_PARSE_LIMIT = 1_000_000;

function normalizedMime(mimeType: string | undefined): string {
  return mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

/** Parse JSON only when its MIME or shape makes the intent unambiguous. */
export function parseJsonDocument(
  text: string,
  mimeType?: string,
  maxLength = JSON_PARSE_LIMIT,
): JsonDocument | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  const mime = normalizedMime(mimeType);
  const declaredJson = mime.includes('json');
  const containerShape =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!declaredJson && !containerShape) return null;

  try {
    const value: unknown = JSON.parse(trimmed);
    return { value, formatted: JSON.stringify(value, null, 2) };
  } catch {
    return null;
  }
}

/** Console strings only become expandable when they contain an object or array. */
export function isJsonContainerText(text: string): boolean {
  return parseJsonDocument(text) !== null;
}

export function detectCodeLanguage(
  text: string,
  mimeType?: string,
  hint?: CodeLanguage,
): CodeLanguage {
  if (hint) return hint;
  const mime = normalizedMime(mimeType);
  if (parseJsonDocument(text, mimeType)) return 'json';
  if (mime.includes('json')) return 'json';
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'javascript';
  if (mime.includes('html')) return 'html';
  if (mime.includes('xml') || mime.includes('svg')) return 'xml';
  if (mime.includes('css')) return 'css';
  if (mime.includes('x-www-form-urlencoded')) return 'form';

  const trimmed = text.trimStart();
  if (/^(?:<!doctype\s+html|<html\b)/i.test(trimmed)) return 'html';
  if (/^<\?xml\b/i.test(trimmed)) return 'xml';
  if (/^(?:curl\s|#!\s*\/.*\b(?:sh|bash)\b)/.test(trimmed)) return 'shell';
  return 'text';
}

function pushToken(tokens: SyntaxToken[], text: string, kind: SyntaxTokenKind): void {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === kind) previous.text += text;
  else tokens.push({ text, kind });
}

function tokenizeJsonLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const pattern = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false)\b|\bnull\b|[{}\[\],:]/g;
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushToken(tokens, line.slice(cursor, index), 'plain');
    const value = match[0];
    let kind: SyntaxTokenKind = 'punctuation';
    if (value.startsWith('"')) {
      kind = /^\s*:/.test(line.slice(index + value.length)) ? 'key' : 'string';
    } else if (/^-?\d/.test(value)) kind = 'number';
    else if (value === 'true' || value === 'false') kind = 'boolean';
    else if (value === 'null') kind = 'null';
    pushToken(tokens, value, kind);
    cursor = index + value.length;
  }
  pushToken(tokens, line.slice(cursor), 'plain');
  return tokens;
}

function tokenizeMarkupLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const pattern = /<!--.*?-->|<\/?[A-Za-z][^>]*>|&(?:#\d+|#x[\da-f]+|\w+);/gi;
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushToken(tokens, line.slice(cursor, index), 'plain');
    const value = match[0];
    if (value.startsWith('<!--')) {
      pushToken(tokens, value, 'comment');
    } else if (!value.startsWith('<')) {
      pushToken(tokens, value, 'string');
    } else {
      const tagMatch = /^(<\/?)([\w:-]+)/.exec(value);
      if (!tagMatch) {
        pushToken(tokens, value, 'tag');
      } else {
        pushToken(tokens, tagMatch[1] ?? '', 'punctuation');
        pushToken(tokens, tagMatch[2] ?? '', 'tag');
        const tail = value.slice(tagMatch[0].length);
        const attrPattern = /([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
        let tailCursor = 0;
        for (const attr of tail.matchAll(attrPattern)) {
          const attrIndex = attr.index ?? 0;
          pushToken(tokens, tail.slice(tailCursor, attrIndex), 'plain');
          pushToken(tokens, attr[1] ?? '', 'attr');
          pushToken(tokens, attr[2] ?? '', 'punctuation');
          pushToken(tokens, attr[3] ?? '', 'string');
          tailCursor = attrIndex + attr[0].length;
        }
        const remainder = tail.slice(tailCursor);
        const closing = /\/?>$/.exec(remainder);
        if (closing?.index !== undefined) {
          pushToken(tokens, remainder.slice(0, closing.index), 'plain');
          pushToken(tokens, closing[0], 'punctuation');
        } else pushToken(tokens, remainder, 'plain');
      }
    }
    cursor = index + match[0].length;
  }
  pushToken(tokens, line.slice(cursor), 'plain');
  return tokens;
}

function tokenizeCssLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const commentIndex = line.indexOf('/*');
  const codeEnd = commentIndex === -1 ? line.length : commentIndex;
  const code = line.slice(0, codeEnd);
  const pattern = /(--?[\w-]+|[\w-]+)(\s*:)|#[\da-f]{3,8}\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:px|rem|em|%|s|ms|vh|vw)?\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushToken(tokens, code.slice(cursor, index), 'plain');
    const value = match[0];
    if (match[2]) {
      pushToken(tokens, match[1] ?? '', 'key');
      pushToken(tokens, match[2], 'punctuation');
    } else if (/^["']/.test(value) || value.startsWith('#')) pushToken(tokens, value, 'string');
    else pushToken(tokens, value, 'number');
    cursor = index + value.length;
  }
  pushToken(tokens, code.slice(cursor), 'plain');
  if (commentIndex !== -1) pushToken(tokens, line.slice(commentIndex), 'comment');
  return tokens;
}

function tokenizeProgramLine(line: string, language: CodeLanguage): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const comment = language === 'shell' ? /#.*/ : /\/\/.*|\/\*.*?\*\//;
  const pattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|-?(?:0|[1-9]\d*)(?:\.\d+)?|\b(?:true|false)\b|\bnull\b|\b(?:const|let|var|function|return|if|else|for|while|new|class|import|export|async|await|throw|try|catch|finally|typeof|instanceof|in|of|this|undefined)\b/g;
  const commentMatch = comment.exec(line);
  const codeEnd = commentMatch?.index ?? line.length;
  const code = line.slice(0, codeEnd);
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushToken(tokens, code.slice(cursor, index), 'plain');
    const value = match[0];
    let kind: SyntaxTokenKind = 'keyword';
    if (/^["'`]/.test(value)) kind = 'string';
    else if (/^-?\d/.test(value)) kind = 'number';
    else if (value === 'true' || value === 'false') kind = 'boolean';
    else if (value === 'null' || value === 'undefined') kind = 'null';
    pushToken(tokens, value, kind);
    cursor = index + value.length;
  }
  pushToken(tokens, code.slice(cursor), 'plain');
  if (commentMatch) pushToken(tokens, line.slice(codeEnd), 'comment');
  return tokens;
}

/** Tokenise one visual line so rendering can remain lazy and line-numbered. */
export function tokenizeCodeLine(line: string, language: CodeLanguage): SyntaxToken[] {
  if (language === 'json') return tokenizeJsonLine(line);
  if (language === 'html' || language === 'xml') return tokenizeMarkupLine(line);
  if (language === 'css') return tokenizeCssLine(line);
  if (language === 'javascript' || language === 'shell') {
    return tokenizeProgramLine(line, language);
  }
  if (language === 'form') {
    const tokens: SyntaxToken[] = [];
    const pattern = /(^|&)([^=&]+)(=)/g;
    let cursor = 0;
    for (const match of line.matchAll(pattern)) {
      const index = match.index ?? 0;
      pushToken(tokens, line.slice(cursor, index), 'string');
      pushToken(tokens, match[1] ?? '', 'punctuation');
      pushToken(tokens, match[2] ?? '', 'key');
      pushToken(tokens, match[3] ?? '', 'punctuation');
      cursor = index + match[0].length;
    }
    pushToken(tokens, line.slice(cursor), 'string');
    return tokens;
  }
  return [{ text: line, kind: 'plain' }];
}

export function formattedStructuredText(text: string, mimeType?: string): string {
  return parseJsonDocument(text, mimeType)?.formatted ?? text;
}
