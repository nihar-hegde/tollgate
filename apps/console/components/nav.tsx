import Link from "next/link";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/decisions", label: "Decisions" },
  { href: "/reviews", label: "Reviews" },
  { href: "/mandates", label: "Mandates" },
];

export function Nav() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Tollgate
        </Link>
        <nav className="flex gap-5 text-sm text-muted-foreground">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs text-muted-foreground">
          Base Sepolia testnet · no real funds
        </span>
      </div>
    </header>
  );
}
