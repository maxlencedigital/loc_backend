const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

type BaseEmailInput = { title: string; bodyHtml: string; preheader?: string };

// Table layout with inline CSS because Gmail/Outlook strip or ignore <style>
// and flexbox. Width is fluid (100% up to 600px) rather than fixed pixels.
// bodyHtml is trusted markup from callers; title and preheader are escaped here.
const renderBaseEmail = ({ title, bodyHtml, preheader }: BaseEmailInput): string => {
  const safeTitle = escapeHtml(title);
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
${hiddenPreheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;">
<tr>
<td style="padding:20px 24px;background-color:#0b5fff;border-radius:8px 8px 0 0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px;">LOC</td>
</tr>
<tr>
<td style="padding:24px;font-size:16px;line-height:24px;color:#1f2933;">
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:28px;color:#102a43;">${safeTitle}</h1>
${bodyHtml}
</td>
</tr>
<tr>
<td style="padding:16px 24px;border-top:1px solid #e4e7eb;font-size:12px;line-height:18px;color:#7b8794;">
You are receiving this email because of activity on your LOC account.<br>
&copy; LOC. All rights reserved.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
};

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&copy;": "(c)",
};

// Plain-text alternative for clients that do not render HTML. Tags are stripped
// BEFORE entities are decoded, so an escaped "&lt;script&gt;" survives as text.
const toPlainText = (html: string): string =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(lt|gt|quot|#39|nbsp|copy);/g, (entity) => ENTITIES[entity])
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export { escapeHtml, renderBaseEmail, toPlainText };
export type { BaseEmailInput };
