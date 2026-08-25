// ABOUTME: Shared TUI helpers — padRight, wordWrap, sideBySide
// ABOUTME: Used by agent-team.ts and other extensions that need text layout utilities

import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

const STATUS_BG: Record<string, string> = {
  running: "\x1b[48;2;26;58;92m",
  done: "\x1b[48;2;35;50;55m",
  error: "\x1b[48;2;70;35;35m",
};
const RESET_BG = "\x1b[49m";
const WHITE_BOLD = "\x1b[1;97m";
const RESET_ALL = "\x1b[0m";

/** Apply the shared dark status background used by agent widgets. */
export function statusBackground(
  text: string,
  status: string,
): string {
  const background = STATUS_BG[status] || STATUS_BG.running;
  return `${background}${WHITE_BOLD}${text}${RESET_ALL}${RESET_BG}`;
}

/** Pad a string with spaces to reach the target visible width, truncating if too long. */
export function padRight(s: string, width: number): string {
  const vis = visibleWidth(s);
  if (vis >= width) return truncateToWidth(s, width, "");
  return s + " ".repeat(width - vis);
}

/** Word-wrap text to fit within a given visible width, breaking long words if needed. */
export function wordWrap(text: string, width: number): string[] {
  if (visibleWidth(text) <= width) return [text];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const wordWidth = visibleWidth(w);
    // If a single word is longer than width, break it
    if (wordWidth > width) {
      if (cur.length > 0) {
        lines.push(cur);
        cur = "";
      }
      // Break long word into chunks
      let remaining = w;
      while (remaining.length > 0) {
        let chunk = "";
        for (const char of remaining) {
          if (visibleWidth(chunk + char) > width && chunk.length > 0) {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        if (chunk.length > 0) {
          cur = chunk;
        }
        remaining = "";
      }
    } else if (visibleWidth(cur + w) > width && cur.length > 0) {
      lines.push(cur);
      cur = w.trimStart();
    } else {
      cur += w;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/** Merge two column arrays side-by-side with a divider string between them. */
export function sideBySide(
  left: string[],
  right: string[],
  leftW: number,
  rightW: number,
  divider: string,
): string[] {
  const max = Math.max(left.length, right.length);
  const result: string[] = [];
  for (let i = 0; i < max; i++) {
    const l = i < left.length ? padRight(left[i], leftW) : " ".repeat(leftW);
    const r = i < right.length ? truncateToWidth(right[i], rightW, "") : "";
    result.push(l + divider + r);
  }
  return result;
}
