import { describe, expect, it } from "vitest";
import { md } from "./markdown";

describe("markdown", () => {
  it("renders a safe subset", () => {
    expect(md("**hi** `x<y` *it*\n- a\n- b\n\n1. one\n# Title\nplain <script>")).toBe("<p><b>hi</b> <code>x&lt;y</code> <i>it</i></p><ul><li>a</li><li>b</li></ul><ul><li>one</li></ul><p>Title<br>plain &lt;script&gt;</p>");
    expect(md("")).toBe("");
  });
});
