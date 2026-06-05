#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DRAFTS_DIR = ROOT / "drafts"
POSTS_DIR = ROOT / "posts"
CONFIG_DIR = ROOT / "config"
POSTS_JSON = CONFIG_DIR / "posts.json"

REQUIRED_FIELDS = ("title", "date", "category", "description", "slug")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True)
class Post:
    title: str
    date: str
    category: str
    description: str
    slug: str
    source: Path
    content_html: str

    @property
    def url(self) -> str:
        return f"../posts/{self.slug}.html"


def parse_front_matter(text: str, source: Path) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError(f"{source}: missing front matter")

    end = text.find("\n---", 4)
    if end == -1:
        raise ValueError(f"{source}: unclosed front matter")

    raw_meta = text[4:end].strip()
    body = text[end + 4 :].lstrip("\r\n")
    meta: dict[str, str] = {}

    for line_number, line in enumerate(raw_meta.splitlines(), start=2):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            raise ValueError(f"{source}:{line_number}: invalid front matter line")

        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            meta[key] = value

    missing = [field for field in REQUIRED_FIELDS if not meta.get(field)]
    if missing:
        raise ValueError(f"{source}: missing fields: {', '.join(missing)}")

    try:
        date.fromisoformat(meta["date"])
    except ValueError as exc:
        raise ValueError(f"{source}: date must use YYYY-MM-DD") from exc

    if not SLUG_RE.match(meta["slug"]):
        raise ValueError(f"{source}: slug must use lowercase letters, numbers, and hyphens")

    return meta, body


def markdown_to_html(markdown_text: str) -> str:
    try:
        import markdown  # type: ignore
    except ImportError:
        return fallback_markdown_to_html(markdown_text)

    return markdown.markdown(
        markdown_text,
        extensions=["extra", "fenced_code", "codehilite", "sane_lists"],
        extension_configs={
            "codehilite": {
                "guess_lang": False,
                "noclasses": False,
            }
        },
        output_format="html5",
    )


def render_inline(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', escaped)
    return escaped


def flush_paragraph(paragraph: list[str], output: list[str]) -> None:
    if not paragraph:
        return
    output.append(f"<p>{render_inline(' '.join(paragraph))}</p>")
    paragraph.clear()


def flush_list(items: list[str], output: list[str]) -> None:
    if not items:
        return
    output.append("<ul>")
    output.extend(f"<li>{render_inline(item)}</li>" for item in items)
    output.append("</ul>")
    items.clear()


def fallback_markdown_to_html(markdown_text: str) -> str:
    output: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    code_lines: list[str] = []
    code_language = ""
    in_code = False

    for raw_line in markdown_text.splitlines():
        line = raw_line.rstrip()

        if line.startswith("```"):
            if in_code:
                escaped_code = html.escape("\n".join(code_lines))
                language_class = f' class="language-{html.escape(code_language)}"' if code_language else ""
                output.append(f'<div class="codehilite"><pre><code{language_class}>{escaped_code}</code></pre></div>')
                code_lines.clear()
                code_language = ""
                in_code = False
            else:
                flush_paragraph(paragraph, output)
                flush_list(list_items, output)
                code_language = line[3:].strip()
                in_code = True
            continue

        if in_code:
            code_lines.append(raw_line)
            continue

        if not line.strip():
            flush_paragraph(paragraph, output)
            flush_list(list_items, output)
            continue

        heading = re.match(r"^(#{2,6})\s+(.+)$", line)
        if heading:
            flush_paragraph(paragraph, output)
            flush_list(list_items, output)
            level = len(heading.group(1))
            output.append(f"<h{level}>{render_inline(heading.group(2))}</h{level}>")
            continue

        list_item = re.match(r"^[-*]\s+(.+)$", line)
        if list_item:
            flush_paragraph(paragraph, output)
            list_items.append(list_item.group(1))
            continue

        if line.startswith("> "):
            flush_paragraph(paragraph, output)
            flush_list(list_items, output)
            output.append(f"<blockquote><p>{render_inline(line[2:])}</p></blockquote>")
            continue

        flush_list(list_items, output)
        paragraph.append(line.strip())

    flush_paragraph(paragraph, output)
    flush_list(list_items, output)

    if in_code:
        raise ValueError("unclosed fenced code block")

    return "\n".join(output)


def render_post(post: Post) -> str:
    title = html.escape(post.title)
    description = html.escape(post.description)
    category = html.escape(post.category)
    display_date = html.escape(post.date.replace("-", "."))

    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <meta name="description" content="{description}">
    <meta name="author" content="BLACK BLUES">
    <meta name="theme-color" content="#0e0e0f">
    <meta property="og:type" content="article">
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{description}">
    <meta name="twitter:card" content="summary">
    <link rel="icon" href="../favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="../assets/css/theme.css">
    <title>{title} | BLACK BLUES</title>
  </head>
  <body>
    <nav aria-label="主要导航">
      <a href="../index.html#home" class="nav-logo"><span aria-hidden="true"></span>BLACK BLUES</a>
      <input class="nav-toggle" id="nav-toggle" type="checkbox" aria-label="打开导航菜单">
      <label class="nav-menu-button" for="nav-toggle" aria-hidden="true"><span></span><span></span><span></span></label>
      <ul class="nav-links">
        <li><a href="../blog/index.html">文章</a></li>
        <li><a href="../index.html#bookmarks">书签</a></li>
        <li><a href="../music/index.html">音乐</a></li>
        <li><a href="../index.html#about">关于</a></li>
      </ul>
      <button id="theme-btn" class="theme-toggle" type="button" aria-label="切换主题">☀️</button>
    </nav>
    <main class="post-main">
      <article class="post">
        <a class="back-link" href="../blog/index.html">← 返回文章</a>
        <div class="post-meta"><span>{category}</span><span>{display_date}</span></div>
        <h1 class="post-title">{title}</h1>
        <p class="post-lede">{description}</p>
        <div class="post-content">
{indent_html(post.content_html, 10)}
        </div>
      </article>
    </main>
    <footer class="site-footer">
      <span>© 2026 blackblues · blackblues.xyz</span>
      <span class="site-footer-links">
        <a href="../blog/index.html">博客</a> ·
        <a href="../music/index.html">音乐</a> ·
        <a href="https://github.com/blackblues360" target="_blank" rel="noopener noreferrer">GitHub</a>
      </span>
    </footer>
    <script src="../script.js"></script>
  </body>
</html>
"""


def indent_html(content: str, spaces: int) -> str:
    prefix = " " * spaces
    return "\n".join(prefix + line if line.strip() else line for line in content.splitlines())


def load_posts() -> list[Post]:
    posts: list[Post] = []
    for source in sorted(DRAFTS_DIR.glob("*.md")):
        text = source.read_text(encoding="utf-8")
        meta, body = parse_front_matter(text, source)
        posts.append(
            Post(
                title=meta["title"],
                date=meta["date"],
                category=meta["category"],
                description=meta["description"],
                slug=meta["slug"],
                source=source,
                content_html=markdown_to_html(body),
            )
        )

    slugs = [post.slug for post in posts]
    duplicate_slugs = sorted({slug for slug in slugs if slugs.count(slug) > 1})
    if duplicate_slugs:
        raise ValueError(f"duplicate slugs: {', '.join(duplicate_slugs)}")

    return sorted(posts, key=lambda post: (post.date, post.slug), reverse=True)


def write_posts(posts: list[Post]) -> None:
    POSTS_DIR.mkdir(exist_ok=True)
    CONFIG_DIR.mkdir(exist_ok=True)

    for post in posts:
        target = POSTS_DIR / f"{post.slug}.html"
        target.write_text(render_post(post), encoding="utf-8")

    index_data = [
        {
            "title": post.title,
            "date": post.date,
            "category": post.category,
            "description": post.description,
            "url": post.url,
        }
        for post in posts
    ]
    POSTS_JSON.write_text(
        json.dumps(index_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    posts = load_posts()
    write_posts(posts)
    print(f"Built {len(posts)} posts")
    print(f"Wrote {POSTS_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
