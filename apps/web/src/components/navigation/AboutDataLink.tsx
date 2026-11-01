import type { ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';

export interface AboutDataLinkProps {
  children: ReactNode;
  className?: string;
}

/**
 * The one link every provenance affordance uses to reach `/sources` (Task 7).
 *
 * `MapCredit`, `RouteCard` and `FareBreakdown` are rendered both inside the
 * router (the real app) and in isolation by their own tests. Rendering a
 * `Link` outside a router throws, and forcing every existing test to add a
 * `MemoryRouter` is unnecessary churn; `useInRouterContext` lets this component
 * render a plain anchor with the same `href` when there is no router, so the
 * entry point still works (and its tests keep their subject under test).
 */
export function AboutDataLink({ children, className }: AboutDataLinkProps) {
  const inRouter = useInRouterContext();
  const classes = [
    'rounded-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!inRouter) {
    return (
      <a href="/sources" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link to="/sources" className={classes}>
      {children}
    </Link>
  );
}
