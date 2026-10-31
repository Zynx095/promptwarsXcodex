// Minimal history-API router: enough for a dozen routes without an extra dependency.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface RouterState {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    const url = new URL(to, window.location.origin);
    setLoc({ path: url.pathname, search: url.search });
    window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ path: loc.path, search: new URLSearchParams(loc.search), navigate }), [loc, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterState {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter outside RouterProvider');
  return ctx;
}

/** Matches "/admin/reports/:id" against a path; returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(s[i]!);
    else if (seg !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { navigate, path } = useRouter();
  const current = to === path || (to !== '/' && to.split('?')[0] === path);
  return (
    <a
      href={to}
      aria-current={current ? 'page' : undefined}
      {...rest}
      onClick={(e) => {
        // A caller's handler (for example, closing the sheet the link sits in) runs first.
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
