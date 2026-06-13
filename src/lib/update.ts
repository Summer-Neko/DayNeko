import { githubRepo } from "./config";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inList = false;
  const html: string[] = [];
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  const inline = (value: string) => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  lines.forEach((line) => {
    if (/^###\s+/.test(line)) {
      closeList();
      html.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      return;
    }
    if (/^##\s+/.test(line)) {
      closeList();
      html.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      return;
    }
    if (/^#\s+/.test(line)) {
      closeList();
      html.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      return;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      return;
    }
    closeList();
    html.push(line.trim() ? `<p>${inline(line)}</p>` : "<br />");
  });
  closeList();
  return html.join("\n");
}

async function fetchReleaseByUrl(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`release notes failed: ${response.status}`);
  return response.json() as Promise<{ body?: string }>;
}

export async function fetchGitHubReleaseNotes(version: string) {
  const normalized = version.trim().replace(/^v/i, "");
  const candidates = [
    `https://api.github.com/repos/${githubRepo}/releases/tags/v${encodeURIComponent(normalized)}`,
    `https://api.github.com/repos/${githubRepo}/releases/tags/${encodeURIComponent(normalized)}`,
    `https://api.github.com/repos/${githubRepo}/releases/latest`
  ];

  for (const url of candidates) {
    try {
      const release = await fetchReleaseByUrl(url);
      if (release.body?.trim()) return release.body;
    } catch {
      // Try the next common tag shape before falling back to updater metadata.
    }
  }

  return null;
}
