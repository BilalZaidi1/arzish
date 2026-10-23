import React, { useMemo } from 'react';

let hooked = false;
function purifier() {
  const p = window.DOMPurify;
  if (p && !hooked && p.addHook) {
    p.addHook('afterSanitizeAttributes', (node: Element) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  return p;
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const mk = window.marked;
    const p = purifier();
    if (!mk || !p) return null;
    try {
      const raw = mk.parse(text, { gfm: true, breaks: false, async: false }) as string;
      return p.sanitize(raw, { FORBID_TAGS: ['style', 'img', 'iframe', 'form', 'input', 'video', 'audio', 'svg', 'math'], FORBID_ATTR: ['style'] });
    } catch {
      return null;
    }
  }, [text]);
  if (html === null) return <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
