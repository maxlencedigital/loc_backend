import { escapeHtml, renderBaseEmail, toPlainText } from "./BaseEmail.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;"
    );
  });

  it("does not double-handle already escaped text beyond escaping the ampersand", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("turns null and undefined into an empty string", () => {
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("renderBaseEmail", () => {
  it("renders a fluid table layout with inline CSS, header and footer", () => {
    const html = renderBaseEmail({ title: "Hello", bodyHtml: "<p>Body text</p>" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain('width="100%"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("<p>Body text</p>");
    expect(html).toContain(">LOC</td>");
    expect(html).toContain("All rights reserved");
    expect(html).not.toContain("<style");
  });

  it("escapes title and preheader but passes trusted bodyHtml through", () => {
    const html = renderBaseEmail({
      title: "<script>alert(1)</script>",
      preheader: `"><img src=x onerror=alert(2)>`,
      bodyHtml: "<strong>ok</strong>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<strong>ok</strong>");
  });

  it("omits the hidden preheader block when none is given", () => {
    expect(renderBaseEmail({ title: "T", bodyHtml: "x" })).not.toContain("display:none");
    expect(renderBaseEmail({ title: "T", bodyHtml: "x", preheader: "Preview" })).toContain("display:none");
  });
});

describe("toPlainText", () => {
  it("strips tags, keeps paragraph breaks and renders links with their URL", () => {
    const text = toPlainText('<h1>Title</h1><p>Hello <strong>Asha</strong></p><p>See <a href="https://loc.test/o/1">your order</a></p>');
    expect(text).toBe("Title\nHello Asha\nSee your order (https://loc.test/o/1)");
  });

  it("drops style and script blocks entirely", () => {
    expect(toPlainText("<style>p{color:red}</style><script>evil()</script><p>Hi</p>")).toBe("Hi");
  });

  it("decodes entities after stripping tags, so escaped markup stays visible as text", () => {
    expect(toPlainText("<p>&lt;script&gt; &amp; &quot;x&quot; &#39;y&#39;</p>")).toBe(`<script> & "x" 'y'`);
  });

  it("turns <br> into newlines", () => {
    expect(toPlainText("a<br>b<br/>c")).toBe("a\nb\nc");
  });
});
