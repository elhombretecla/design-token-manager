/**
 * utils/esc.ts
 *
 * HTML entity escaping for safely inserting user-supplied strings into
 * innerHTML template literals without XSS risk.
 */

export function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
