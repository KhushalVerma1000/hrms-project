'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NavLink, type NavItem } from './nav-link';
import { LogoutButton } from './logout-button';

export function MobileNav({
  navItems,
  userName,
  userEmail,
  userRole,
}: {
  navItems: NavItem[];
  userName: string;
  userEmail: string;
  userRole: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 bg-slate-900 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-lg bg-primary flex items-center justify-center font-bold text-white text-sm">
            WW
          </div>
          <p className="text-sm font-bold text-white truncate">Workforce Platform</p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-800" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-3/4 max-w-xs bg-slate-900 border-slate-800 p-0 flex flex-col">
            <SheetHeader className="p-6 border-b border-slate-800">
              <SheetTitle className="text-white text-sm font-bold">Workforce Platform</SheetTitle>
              <p className="text-xs text-blue-400 font-mono capitalize">{userRole.toLowerCase().replace(/_/g, ' ')}</p>
            </SheetHeader>

            <nav className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {navItems.map((item) => (
                <NavLink key={item.href} {...item} onNavigate={() => setOpen(false)} />
              ))}
            </nav>

            <div className="p-4 border-t border-slate-800 bg-slate-950/40 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-xs text-primary shrink-0">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{userName}</p>
                  <p className="text-[11px] text-slate-400 truncate">{userEmail}</p>
                </div>
              </div>
              <LogoutButton />
            </div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
