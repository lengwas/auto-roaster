import { useState, useRef, useEffect } from 'react';

export type TabKey =
  | 'shift'
  | 'auto-assign'
  | 'sales'
  | 'dashboard'
  | 'customers'
  | 'commission'
  | 'pc-setting'
  | 'store-setting'
  | 'inventory'
  | 'db-schema'
  | 'attendance'
  | 'guide'
  | 'changelog';

export type CommissionView = 'upload' | 'salesmap' | 'promoter' | 'claims' | 'returns';

export interface NavSelection {
  tab: TabKey;
  commissionView?: CommissionView;
}

interface NavItem {
  label: string;
  tab: TabKey;
  commissionView?: CommissionView;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Roaster',
    items: [
      { label: 'Shift Table', tab: 'shift' },
      { label: 'Auto Assign', tab: 'auto-assign' },
    ],
  },
  {
    label: 'Dashboard',
    items: [
      { label: 'PC Performance', tab: 'sales' },
      { label: 'Order Analysis', tab: 'dashboard' },
      { label: 'Customer Analysis', tab: 'customers' },
    ],
  },
  {
    label: 'Commission',
    items: [
      { label: 'Vendor Upload', tab: 'commission', commissionView: 'upload' },
      { label: 'Sales Order Map', tab: 'commission', commissionView: 'salesmap' },
      { label: 'Promoter Commission', tab: 'commission', commissionView: 'promoter' },
      { label: 'Jotform Claim', tab: 'commission', commissionView: 'claims' },
      { label: 'Return Order', tab: 'commission', commissionView: 'returns' },
    ],
  },
  {
    label: 'Setting',
    items: [
      { label: 'Promoter', tab: 'pc-setting' },
      { label: 'Store', tab: 'store-setting' },
      { label: 'Inventory', tab: 'inventory' },
    ],
  },
  {
    label: 'More',
    items: [
      { label: 'Database', tab: 'db-schema' },
      { label: 'Attendance', tab: 'attendance' },
      { label: 'Guide', tab: 'guide' },
      { label: 'Changelog', tab: 'changelog' },
    ],
  },
];

interface NavBarProps {
  activeTab: TabKey;
  commissionView: CommissionView;
  onSelect: (sel: NavSelection) => void;
}

export function NavBar({ activeTab, commissionView, onSelect }: NavBarProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Close the open dropdown when clicking outside the nav.
  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openGroup]);

  const isItemActive = (item: NavItem) =>
    item.tab === activeTab &&
    (item.tab !== 'commission' || item.commissionView === commissionView);

  return (
    <nav className="tab-nav" ref={navRef}>
      {NAV_GROUPS.map((group) => {
        const groupActive = group.items.some(isItemActive);
        const isOpen = openGroup === group.label;
        return (
          <div key={group.label} className="nav-group">
            <button
              className={`tab-btn nav-group-btn ${groupActive ? 'tab-active' : ''}`}
              onClick={() => setOpenGroup(isOpen ? null : group.label)}
              aria-expanded={isOpen}
            >
              {group.label}
              <span className="nav-caret" aria-hidden>▾</span>
            </button>
            {isOpen && (
              <div className="nav-dropdown">
                {group.items.map((item) => (
                  <button
                    key={item.label}
                    className={`nav-dropdown-item ${isItemActive(item) ? 'nav-dropdown-item-active' : ''}`}
                    onClick={() => {
                      onSelect({ tab: item.tab, commissionView: item.commissionView });
                      setOpenGroup(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
