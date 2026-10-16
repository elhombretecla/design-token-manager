import { describe, expect, it } from "vitest";
import { esc } from "./esc";

describe("esc", () => {
  it("escapes HTML-significant characters", () => {
    expect(esc(`<img src="x" onerror='y'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;",
    );
  });
});
