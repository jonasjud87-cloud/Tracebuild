/**
 * Namespace-neutraler XML-Leser für ÖREB-Antworten (SO, SH liefern nur XML). Attribute
 * werden ignoriert, Präfixe entfernt, wiederholte Elemente zu Arrays. Kein externer Parser.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface Frame {
  children: Record<string, unknown>;
  text: string;
}

function addChild(parent: Frame, name: string, value: unknown): void {
  if (name in parent.children) {
    const current = parent.children[name];
    if (Array.isArray(current)) current.push(value);
    else parent.children[name] = [current, value];
  } else {
    parent.children[name] = value;
  }
}

export function xmlToObject(xml: string): Record<string, unknown> {
  const source = xml
    .replace(/<\?[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) =>
      c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );
  const tag = /<(\/?)(?:[\w.-]+:)?([\w.-]+)(?:\s[^<>]*?)?(\/?)>|([^<]+)/g;
  const stack: Frame[] = [{ children: {}, text: "" }];
  let m: RegExpExecArray | null;
  while ((m = tag.exec(source))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.text += decodeEntities(m[4]);
    } else if (m[1]) {
      if (stack.length < 2) continue; // Überzähliges schliessendes Element: tolerieren.
      const frame = stack.pop() as Frame;
      const value = Object.keys(frame.children).length ? frame.children : frame.text.trim();
      addChild(stack[stack.length - 1], m[2], value);
    } else if (m[3]) {
      addChild(top, m[2], "");
    } else {
      stack.push({ children: {}, text: "" });
    }
  }
  return stack[0].children;
}
