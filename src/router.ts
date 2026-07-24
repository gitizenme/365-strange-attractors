export type Route =
  | { kind: 'home' } | { kind: 'day'; slug: string } | { kind: 'today' }
  | { kind: 'attractors' } | { kind: 'sound' } | { kind: 'story' };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '');
  const day = p.match(/^\/day\/([0-9]{3}-[a-z0-9-]+)$/);
  if (day) return { kind: 'day', slug: day[1] };
  if (p === '/today') return { kind: 'today' };
  // legacy paths keep resolving so pre-redesign links never break; Router.go(current, {replace:true})
  // at boot rewrites the address bar onto the canonical path without adding a history entry
  if (p === '/attractors' || p === '/index') return { kind: 'attractors' };
  if (p === '/sound' || p === '/music') return { kind: 'sound' };
  if (p === '/story' || p === '/about') return { kind: 'story' };
  return { kind: 'home' };
}

export function routePath(r: Route): string {
  switch (r.kind) {
    case 'home': return '/';
    case 'day': return `/day/${r.slug}/`;
    case 'today': return '/today/';
    case 'attractors': return '/attractors/';
    case 'sound': return '/sound/';
    case 'story': return '/story/';
  }
}

export class Router {
  private onChange: (r: Route) => void;
  constructor(onChange: (r: Route) => void) {
    this.onChange = onChange;
    window.addEventListener('popstate', () => this.onChange(this.current()));
  }
  current(): Route { return parseRoute(location.pathname); }
  go(r: Route, opts: { replace?: boolean } = {}): void {
    if (routePath(r) !== location.pathname) {
      if (opts.replace) history.replaceState(null, '', routePath(r));
      else history.pushState(null, '', routePath(r));
    }
    this.onChange(r);
  }
}
