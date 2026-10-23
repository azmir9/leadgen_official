'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type DashboardLink = { label: string; href: string };

export function DashboardNavigation({ role, links, workspaceId }: { role: 'Super Admin' | 'Admin' | 'Worker'; links: DashboardLink[]; workspaceId?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const mobileClose = useRef<HTMLButtonElement>(null);
  const mobileDrawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--dashboard-sidebar-width', collapsed ? '5rem' : '16rem');
  }, [collapsed]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileClose.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        mobileTrigger.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !mobileDrawer.current) return;
      const focusable = mobileDrawer.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!mobileDrawer.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) {
        setMobileOpen(false);
        window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.dashboard-sidebar button')?.focus());
      }
    }

    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    desktopQuery.addEventListener('change', closeOnDesktop);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktopQuery.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen]);

  function toggleSidebar() {
    setCollapsed((current) => !current);
  }

  function closeMobileNavigation() {
    setMobileOpen(false);
    mobileTrigger.current?.focus();
  }

  const linkList = (mobile = false) => <nav aria-label={`${role} navigation`} className="dashboard-nav-list grid gap-1.5">
    {links.map((link, index) => {
      const href = role === 'Super Admin' && workspaceId && link.href.startsWith('/super-admin/')
        ? `${link.href}?workspace=${encodeURIComponent(workspaceId)}`
        : link.href;
      return <Link key={link.href} data-active={pathname === link.href} href={href} title={collapsed && !mobile ? link.label : undefined} onClick={() => { if (mobile) closeMobileNavigation(); }} className="dashboard-nav-link flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors">
      <span aria-hidden="true" className="dashboard-nav-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold">{String(index + 1).padStart(2, '0')}</span>
      {(!collapsed || mobile) && <span className="truncate">{link.label}</span>}
      </Link>;
    })}
  </nav>;

  return <>
    <aside className={`dashboard-sidebar fixed inset-y-0 left-0 z-30 hidden overflow-y-auto overscroll-contain border-r p-3 transition-[width] duration-200 lg:block ${collapsed ? 'w-20' : 'w-64'}`}>
      <div className="flex h-14 items-center justify-between gap-2 border-b border-slate-100 px-2 pb-3">
        <span className={`${collapsed ? 'sr-only' : 'truncate'} text-sm font-extrabold tracking-wide text-white`}>LEADGEN OFFICIAL</span>
        <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={toggleSidebar} className="min-h-10 min-w-10 rounded-lg border text-sm hover:bg-slate-50">
          <svg aria-hidden="true" className="mx-auto h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} /></svg>
        </button>
      </div>
      <p className={`px-2 pb-2 pt-4 text-[11px] font-bold uppercase tracking-widest text-slate-400 ${collapsed ? 'sr-only' : ''}`}>{role}</p>
      {linkList()}
    </aside>

    <header className="dashboard-mobile-header fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-start gap-3 border-b px-3 shadow-sm backdrop-blur lg:hidden">
      <button ref={mobileTrigger} type="button" aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileOpen} aria-controls="dashboard-mobile-navigation" onClick={() => setMobileOpen((open) => !open)} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border">
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={mobileOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
      </button>
      <span className="truncate text-sm font-extrabold tracking-wide">Leadgen Official <span className="font-medium opacity-75">· {role}</span></span>
    </header>

    {mobileOpen && <>
      <button type="button" aria-label="Close navigation menu" className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" onClick={closeMobileNavigation} />
      <div ref={mobileDrawer} id="dashboard-mobile-navigation" role="dialog" aria-modal="true" aria-label={`${role} navigation menu`} className="dashboard-mobile-drawer fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col overflow-y-auto border-r p-4 shadow-xl lg:hidden">
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3 border-b border-slate-700 pb-3">
          <span className="truncate text-sm font-bold text-white">{role} menu</span>
          <button ref={mobileClose} type="button" aria-label="Close navigation menu" onClick={closeMobileNavigation} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-white hover:bg-slate-800">
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {linkList(true)}
      </div>
    </>}
  </>;
}
