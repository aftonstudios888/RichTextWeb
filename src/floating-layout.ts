export type TextWrappingStyle =
  | "Inline"
  | "Square"
  | "Tight"
  | "TopAndBottom"
  | "BehindText"
  | "InFrontOfText";
export interface FloatingLayoutOptions {
  WrapStyle?: TextWrappingStyle;
  Width?: number;
  Height?: number;
  HorizontalAlignment?: "Left" | "Center" | "Right" | "Stretch";
  HorizontalOffset?: number;
  VerticalOffset?: number;
  Rotation?: number;
  WrapDistance?: number;
  Shape?: "Rectangle" | "Ellipse";
}
export interface FloatingLayoutDiagnostic {
  ElementId: string;
  Message: string;
}

/** Validate an entire requested change before mutating the document. */
export function normalizeFloatingLayout(
  value: FloatingLayoutOptions,
): FloatingLayoutOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Floating layout must be an options object.");
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      [
        "Width",
        "Height",
        "HorizontalOffset",
        "VerticalOffset",
        "Rotation",
        "WrapDistance",
      ].includes(key)
    ) {
      if (typeof raw !== "number" || !Number.isFinite(raw))
        throw new TypeError(`${key} must be a finite number.`);
      const minimum =
        key === "Width" || key === "Height"
          ? 1
          : key === "WrapDistance"
            ? 0
            : -20000;
      const maximum = key === "Rotation" ? 360 : 20000;
      if (raw < minimum || raw > maximum || (key === "Rotation" && raw < -360))
        throw new RangeError(`${key} is outside the supported layout range.`);
      result[key] = raw;
    } else if (key === "WrapStyle") {
      if (
        ![
          "Inline",
          "Square",
          "Tight",
          "TopAndBottom",
          "BehindText",
          "InFrontOfText",
        ].includes(String(raw))
      )
        throw new TypeError("Unsupported text wrapping style.");
      result[key] = raw;
    } else if (key === "HorizontalAlignment") {
      if (!["Left", "Center", "Right", "Stretch"].includes(String(raw)))
        throw new TypeError("Unsupported horizontal alignment.");
      result[key] = raw;
    } else if (key === "Shape") {
      if (raw !== "Rectangle" && raw !== "Ellipse")
        throw new TypeError("Unsupported wrapping shape.");
      result[key] = raw;
    } else throw new TypeError(`Unsupported floating layout property: ${key}`);
  }
  return result as FloatingLayoutOptions;
}
