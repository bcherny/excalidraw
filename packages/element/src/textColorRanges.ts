import type { ExcalidrawTextElement, TextColorRange } from "./types";

/**
 * Apply a color to a range of text. If color matches strokeColor, the override
 * is removed (reverts to default).
 */
export const applyColorToRange = (
  existing: readonly TextColorRange[] | undefined,
  start: number,
  end: number,
  color: string,
  strokeColor: string,
): readonly TextColorRange[] => {
  if (start >= end) {
    return existing ?? [];
  }

  const isDefaultColor = color === strokeColor;

  // Build new ranges: remove any overlap with [start, end], then add new range
  const result: TextColorRange[] = [];

  if (existing) {
    for (const range of existing) {
      if (range.end <= start || range.start >= end) {
        // No overlap — keep as-is
        result.push(range);
      } else {
        // Overlap — split around the new range
        if (range.start < start) {
          result.push({ start: range.start, end: start, color: range.color });
        }
        if (range.end > end) {
          result.push({ start: end, end: range.end, color: range.color });
        }
      }
    }
  }

  // Add the new range (unless it's the default color)
  if (!isDefaultColor) {
    result.push({ start, end, color });
  }

  return cleanupColorRanges(result, Infinity);
};

/**
 * Shift color range indices when text is edited (characters inserted/deleted).
 * editStart: position where the edit occurred (in originalText)
 * insertedLength: number of characters inserted at editStart
 * deletedLength: number of characters deleted starting at editStart
 */
export const shiftColorRanges = (
  ranges: readonly TextColorRange[] | undefined,
  editStart: number,
  insertedLength: number,
  deletedLength: number,
): readonly TextColorRange[] | undefined => {
  if (!ranges?.length) {
    return ranges;
  }

  const delta = insertedLength - deletedLength;
  const editEnd = editStart + deletedLength;
  const result: TextColorRange[] = [];

  for (const range of ranges) {
    if (range.end <= editStart) {
      // Entirely before edit — unchanged
      result.push(range);
    } else if (range.start >= editEnd) {
      // Entirely after edit — shift by delta
      result.push({
        start: range.start + delta,
        end: range.end + delta,
        color: range.color,
      });
    } else {
      // Overlaps with edit region
      let newStart = range.start;
      let newEnd = range.end;

      if (range.start < editStart) {
        // Range starts before edit
        newEnd = Math.max(
          editStart,
          range.end - deletedLength + insertedLength,
        );
      } else {
        // Range starts within or after deleted region
        newStart = editStart + insertedLength;
        newEnd = newStart + Math.max(0, range.end - editEnd);
      }

      if (newStart < newEnd) {
        result.push({ start: newStart, end: newEnd, color: range.color });
      }
    }
  }

  return result.length ? result : undefined;
};

/**
 * Map originalText color ranges to the wrapped `text` string, returning a
 * per-character color array. Returns null if no colorRanges (optimization).
 */
export const getPerCharColors = (
  element: ExcalidrawTextElement,
  theme: "light" | "dark",
  applyDarkModeFilter: (color: string) => string,
): string[] | null => {
  if (!element.colorRanges?.length) {
    return null;
  }

  const { originalText, text, strokeColor, colorRanges } = element;

  const defaultColor =
    theme === "dark" ? applyDarkModeFilter(strokeColor) : strokeColor;

  // Build per-char color array for originalText
  const origColors = new Array<string>(originalText.length).fill(defaultColor);
  for (const range of colorRanges) {
    const clampedStart = Math.max(0, range.start);
    const clampedEnd = Math.min(originalText.length, range.end);
    const color =
      theme === "dark" ? applyDarkModeFilter(range.color) : range.color;
    for (let i = clampedStart; i < clampedEnd; i++) {
      origColors[i] = color;
    }
  }

  // Map originalText indices to wrapped text indices.
  // The wrapped `text` is derived from `originalText` by replacing some
  // spaces/newlines during wrapping. We do a character-by-character walk.
  const wrappedColors: string[] = [];
  let origIdx = 0;

  for (let i = 0; i < text.length; i++) {
    if (origIdx < originalText.length) {
      if (text[i] === originalText[origIdx]) {
        wrappedColors.push(origColors[origIdx]);
        origIdx++;
      } else if (text[i] === "\n" && originalText[origIdx] === " ") {
        // Word wrap converted space to newline
        wrappedColors.push(origColors[origIdx]);
        origIdx++;
      } else {
        // Inserted by wrapping (e.g., newline for break)
        wrappedColors.push(defaultColor);
      }
    } else {
      wrappedColors.push(defaultColor);
    }
  }

  return wrappedColors;
};

/**
 * Group consecutive characters with the same color into segments for rendering.
 */
export const getColorSegments = (
  line: string,
  lineColors: string[],
): { text: string; color: string }[] => {
  if (!line.length) {
    return [{ text: "", color: lineColors[0] || "" }];
  }

  const segments: { text: string; color: string }[] = [];
  let currentColor = lineColors[0];
  let currentText = line[0];

  for (let i = 1; i < line.length; i++) {
    if (lineColors[i] === currentColor) {
      currentText += line[i];
    } else {
      segments.push({ text: currentText, color: currentColor });
      currentColor = lineColors[i];
      currentText = line[i];
    }
  }
  segments.push({ text: currentText, color: currentColor });

  return segments;
};

/**
 * Clamp/remove out-of-bounds ranges, merge adjacent same-color ranges, sort.
 */
export const cleanupColorRanges = (
  ranges: readonly TextColorRange[],
  textLength: number,
): readonly TextColorRange[] => {
  // Clamp and filter
  const clamped = ranges
    .map((r) => ({
      start: Math.max(0, r.start),
      end: Math.min(textLength, r.end),
      color: r.color,
    }))
    .filter((r) => r.start < r.end);

  if (!clamped.length) {
    return [];
  }

  // Sort by start
  clamped.sort((a, b) => a.start - b.start || a.end - b.end);

  // Merge adjacent/overlapping same-color ranges
  const merged: TextColorRange[] = [clamped[0]];
  for (let i = 1; i < clamped.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = clamped[i];
    if (curr.color === prev.color && curr.start <= prev.end) {
      merged[merged.length - 1] = {
        start: prev.start,
        end: Math.max(prev.end, curr.end),
        color: prev.color,
      };
    } else {
      merged.push(curr);
    }
  }

  return merged;
};
