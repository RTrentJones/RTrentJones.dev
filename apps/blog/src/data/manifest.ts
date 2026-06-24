// Live project + provider details, sourced from the wrapper's manifest (greenlight.config.ts — the
// single source of truth) so the projects page reflects what's actually deployed. The content
// collection owns each write-up; this owns the stack (lane × target × data) + the derived providers.
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

export interface RegisteredTool {
  name: string;
  url: string;
  facets: Facets;
  providers: string[];
  envs: string[];
  access?: string;
}

/** A tool's live URL: subdomain per tool (apex for the blog); MCP servers serve at /mcp. */
function urlFor(name: string, facets: Facets): string {
  const base = name === 'blog' ? `https://${domain}/` : `https://${name}.${domain}/`;
  return facets.lane === 'mcp' ? `${base}mcp` : base;
}

const blogFacets: Facets = { name: 'blog', ...(config as unknown as { blog: Facets }).blog };

/** The FULL deployed inventory — the site itself plus every tool registered via `greenlight add`.
 * Rendered collapsed on /projects as a verification: nothing deployed should slip off the curated
 * showcase (e.g. muse, the agent, and the blog have no card but are deployed). */
export const registeredTools: RegisteredTool[] = [
  {
    name: 'blog',
    url: urlFor('blog', blogFacets),
    facets: blogFacets,
    providers: providersFor(blogFacets),
    envs: ['prod'],
    access: 'public',
  },
  ...(config as unknown as { tools: (Facets & { access?: string; envs?: string[] })[] }).tools.map(
    (t) => ({
      name: t.name,
      url: urlFor(t.name, t),
      facets: t,
      providers: providersFor(t),
      envs: t.envs ?? [],
      access: t.access,
    }),
  ),
];
