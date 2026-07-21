export type Route =
  | { kind: 'home' } | { kind: 'day'; slug: string }
  | { kind: 'index' } | { kind: 'about' } | { kind: 'music' };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '');
  const day = p.match(/^\/day\/([0-9]{3}-[a-z0-9-]+)$/);
  if (day) return { kind: 'day', slug: day[1] };
  if (p === '/index') return { kind: 'index' };
  if (p === '/about') return { kind: 'about' };
  if (p === '/music') return { kind: 'music' };
  return { kind: 'home' };
}

export function routePath(r: Route): string {
  switch (r.kind) {
    case 'home': return '/';
    case 'day': return `/day/${r.slug}/`;
    case 'index': return '/index/';
    case 'about': return '/about/';
    case 'music': return '/music/';
  }
}

export class Router {
  private onChange: (r: Route) => void;
  constructor(onChange: (r: Route) => void) {
    this.onChange = onChange;
    window.addEventListener('popstate', () => this.onChange(this.current()));
  }
  current(): Route { return parseRoute(location.pathname); }
  go(r: Route): void {
    if (routePath(r) !== location.pathname) history.pushState(null, '', routePath(r));
    this.onChange(r);
  }
}
