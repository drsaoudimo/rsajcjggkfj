import React, { useState } from 'react';

interface FormattedArticleProps {
  content: string;
}

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="my-5 rounded-xl overflow-hidden border border-slate-700/70 bg-[#070912] shadow-lg" dir="ltr">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-b border-slate-800 text-[11px] font-mono text-slate-400">
        <span className="uppercase tracking-wider text-cyan-400 font-semibold">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors text-[10px]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs sm:text-sm leading-relaxed font-mono text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function renderInline(text: string): React.ReactNode[] {
  // Tokenize inline code `...`, bold **...**, italic *...*, and inline math $...$
  const tokens: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\$[^$\n]+\$|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code
          key={key++}
          dir="ltr"
          className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-slate-800/90 border border-slate-700/60 text-cyan-300 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={key++} className="font-bold text-white">
          {renderInline(token.slice(2, -2))}
        </strong>
      );
    } else if (token.startsWith('$') && token.endsWith('$')) {
      tokens.push(
        <span
          key={key++}
          dir="ltr"
          className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-indigo-950/50 border border-indigo-500/20 text-indigo-200 font-mono text-[0.88em]"
        >
          {token.slice(1, -1)}
        </span>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={key++} className="italic text-slate-200">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|[\s:|-]+\|$/.test(trimmed);
}

export const FormattedArticle: React.FC<FormattedArticleProps> = ({ content }) => {
  if (!content) return null;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      blocks.push(<CodeBlock key={blockKey++} language={lang} code={codeLines.join('\n')} />);
      continue;
    }

    // Display math block $$ ... $$ or \[ ... \]
    if (trimmed === '$$' || trimmed === '\\[' || (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4)) {
      if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
        blocks.push(
          <div
            key={blockKey++}
            dir="ltr"
            className="my-4 p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/25 text-indigo-100 font-mono text-sm sm:text-base overflow-x-auto text-center"
          >
            {trimmed.slice(2, -2).trim()}
          </div>
        );
        i++;
        continue;
      }
      const endMarker = trimmed === '$$' ? '$$' : '\\]';
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== endMarker) {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // consume closing marker
      blocks.push(
        <div
          key={blockKey++}
          dir="ltr"
          className="my-4 p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/25 text-indigo-100 font-mono text-sm sm:text-base overflow-x-auto text-center whitespace-pre"
        >
          {mathLines.join('\n').trim()}
        </div>
      );
      continue;
    }

    // Bracketed single-line math [ ... ] common in Arabic math prompts
    if (trimmed === '[' && i + 2 < lines.length && lines[i + 2].trim() === ']') {
      blocks.push(
        <div
          key={blockKey++}
          dir="ltr"
          className="my-4 p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/25 text-indigo-100 font-mono text-sm sm:text-base overflow-x-auto text-center"
        >
          {lines[i + 1].trim()}
        </div>
      );
      i += 3;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={blockKey++} className="my-6 border-slate-800" />);
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      if (level === 1) {
        blocks.push(
          <h2
            key={blockKey++}
            className="text-2xl font-black text-white mt-8 mb-4 pb-2 border-b border-white/10"
          >
            {renderInline(headingText)}
          </h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h3
            key={blockKey++}
            className="text-xl font-extrabold text-cyan-300 mt-7 mb-3 pb-1.5 border-b border-cyan-500/20"
          >
            {renderInline(headingText)}
          </h3>
        );
      } else if (level === 3) {
        blocks.push(
          <h4 key={blockKey++} className="text-lg font-bold text-indigo-300 mt-5 mb-2">
            {renderInline(headingText)}
          </h4>
        );
      } else {
        blocks.push(
          <h5 key={blockKey++} className="text-base font-bold text-slate-100 mt-4 mb-2">
            {renderInline(headingText)}
          </h5>
        );
      }
      i++;
      continue;
    }

    // Markdown Table
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(
          lines[i]
            .trim()
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())
        );
        i++;
      }
      blocks.push(
        <div key={blockKey++} className="my-5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
          <table className="w-full text-sm text-right border-collapse">
            <thead>
              <tr className="bg-slate-900/90 border-b border-slate-800 text-cyan-300">
                {headerCells.map((cell, idx) => (
                  <th key={idx} className="px-4 py-3 font-bold whitespace-nowrap">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={blockKey++}
          className="my-4 pr-4 pl-3 py-3 border-r-4 border-cyan-500/70 bg-cyan-950/20 rounded-l-xl text-slate-200 leading-relaxed"
        >
          {renderInline(quoteLines.join(' '))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={blockKey++} className="my-3 space-y-2 pr-5 list-disc marker:text-cyan-400 text-slate-300 leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={blockKey++} className="my-3 space-y-2 pr-5 list-decimal marker:text-indigo-400 marker:font-bold text-slate-300 leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (collect consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('$$') &&
      !lines[i].trim().startsWith('>') &&
      !isTableRow(lines[i]) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p key={blockKey++} className="my-3 text-slate-200/95 leading-[1.95] text-base sm:text-[17px]">
          {renderInline(paraLines.join(' '))}
        </p>
      );
    } else {
      i++;
    }
  }

  return <div className="space-y-1 text-right">{blocks}</div>;
};
