'use client';

import {
  BarChart3,
  Bell,
  Briefcase,
  LayoutDashboard,
  Map,
  Settings,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@towing/web-ui';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/map', label: 'Live Map', icon: Map },
  { href: '/trucks', label: 'Trucks', icon: Truck },
  { href: '/drivers', label: 'Drivers', icon: Users },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/earnings', label: 'Earnings', icon: Wallet },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-input px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand text-on-brand'
                : 'text-text-secondary hover:bg-surface1 hover:text-text-primary',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
