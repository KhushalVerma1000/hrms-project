export type NavItem = { href: string; label: string; icon: string };

export function NavLink({
  href,
  label,
  icon,
  onNavigate,
}: NavItem & { onNavigate?: () => void }) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-all text-sm font-medium"
    >
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </a>
  );
}
