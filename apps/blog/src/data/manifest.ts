// Live project + provider details, sourced from the wrapper's manifest (greenlight.config.ts — the
// single source of truth) so the projects page reflects what's actually deployed. The content
// collection owns each write-up; this owns the stack (lane × target × data), the derived providers,
// and env-aware tool URLs — derived via the framework's own `resolveUrl` so links match the
// environment you're viewing (beta blog → beta tools), with no convention reimplemented here.
import { resolveUrl } from '@rtrentjones/greenlight';
import config from '../../../../greenlight.config.ts';

export interface Facets {
  name: string;
  lane: string;
  target: string;
  data: string;
  envs?: string[];
}

const tools = (config as unknown as { tools: Facets[] }).tools;

/** A project's manifest facets by name/slug (undefined for projects that aren't deployed tools). */
export const toolByName: Record<string, Facets> = Object.fromEntries(tools.map((t) => [t.name, t]));

const PROVIDER_LABEL: Record<string, string> = {
  cloudflare: 'Cloudflare',
  vercel: 'Vercel',
  oci: 'Oracle Cloud',
  neon: 'Neon',
  supabase: 'Supabase',
  kv: 'Workers KV',
  d1: 'Cloudflare D1',
  gemini: 'Gemini',
};

/** The providers a tool leans on, derived from its lane × target × data (mirrors the CLI's packs).
 * Cloudflare is the edge/DNS for every tool; target adds the host; data adds the store; the agent
 * lane adds the LLM. */
export function providersFor(t: Facets): string[] {
  const ids = new Set(['cloudflare']);
  if (t.target === 'vercel') ids.add('vercel');
  if (t.target === 'oci') ids.add('oci');
  if (t.data === 'neon') ids.add('neon');
  if (t.data === 'supabase') ids.add('supabase');
  if (t.data === 'kv') ids.add('kv');
  if (t.data === 'd1') ids.add('d1');
  if (t.lane === 'agent') ids.add('gemini');
  return [...ids].map((id) => PROVIDER_LABEL[id] ?? id);
}

/** Compact "lane · target · data" for the card. */
export function stackLine(t: Facets): string {
  const parts = [t.lane, t.target];
  if (t.data && t.data !== 'none') parts.push(t.data);
  return parts.join(' · ');
}

export const domain = (config as unknown as { domain: string }).domain;

const blogFacets: Facets = { name: 'blog', ...(config as unknown as { blog: Facets }).blog };

// --- env-aware URLs ------------------------------------------------------------------------------

export type Env = 'beta' | 'prod';

/** Which environment the current render targets, from the blog's own host (Astro.site). A beta build
 * gets SITE_URL=https://beta.rtrentjones.dev (set by the Greenlight deploy adapter). */
export const envFromSite = (site?: URL): Env =>
  site?.hostname.startsWith('beta.') ? 'beta' : 'prod';

/** A deployed tool's URL in the given env, via the framework's URL scheme (`resolveUrl`). Falls back
 * to prod when the tool has no beta deployment (its `envs` excludes beta), so prod-only tools (bamcp,
 * muse) never get a dead `beta.` link. The blog is the apex (no subdomain); MCP tools serve at /mcp. */
export function toolUrl(name: string, env: Env): string {
  const facets = name === 'blog' ? blogFacets : toolByName[name];
  const hasBeta = name === 'blog' || Boolean(facets?.envs?.includes('beta'));
  return resolveUrl({
    domain,
    name: name === 'blog' ? undefined : name,
    env: env === 'beta' && hasBeta ? 'beta' : 'prod',
    mcp: facets?.lane === 'mcp',
  });
}

export interface RegisteredTool {
  name: string;
  facets: Facets;
  providers: string[];
  envs: string[];
  access?: string;
}

/** The FULL deployed inventory — the site itself plus every tool registered via `greenlight add`.
 * Rendered collapsed on /projects as a verification: nothing deployed should slip off the curated
 * showcase (e.g. muse, the agent, and the blog have no card but are deployed). URLs are derived per
 * render with `toolUrl(name, env)` so they're env-aware. */
export const registeredTools: RegisteredTool[] = [
  {
    name: 'blog',
    facets: blogFacets,
    providers: providersFor(blogFacets),
    envs: ['prod'],
    access: 'public',
  },
  ...(config as unknown as { tools: (Facets & { access?: string; envs?: string[] })[] }).tools.map(
    (t) => ({
      name: t.name,
      facets: t,
      providers: providersFor(t),
      envs: t.envs ?? [],
      access: t.access,
    }),
  ),
];
