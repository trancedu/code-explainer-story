export function scrollTopToLine(scrollTop: number, lineHeight: number, lineCount: number): number {
  return clamp(Math.round(scrollTop / Math.max(1, lineHeight)), 0, Math.max(0, lineCount - 1));
}

export function lineToScrollTop(line: number, lineHeight: number): number {
  return Math.max(0, line * Math.max(1, lineHeight));
}

export function bottomScrollPadding(contentHeight: number, lineHeight: number, minPadding = 40): number {
  return Math.max(minPadding, contentHeight - Math.max(1, lineHeight));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
