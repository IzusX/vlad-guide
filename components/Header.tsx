import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground text-sm">
            ⛩
          </span>
          VladGuide AI
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/" className="rounded-4xl px-3 py-1.5 hover:bg-muted/30">
            Маршруты
          </Link>
          <a
            href="https://github.com/IzusX/vlad-guide"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden rounded-4xl border px-3 py-1.5 hover:bg-muted/30 sm:inline-flex"
          >
            GitHub
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
