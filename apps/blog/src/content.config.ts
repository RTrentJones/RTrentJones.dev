import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
  }),
});

// Projects, listed on /projects. Ones with a local write-up render at the top level
// (/heistmind, /bamcp, …) via [project].astro — the slug = the filename, so it must not collide
// with a static route (about, blog, projects, rss.xml). An `external: true` project gets no local
// page; its card links straight out to repoUrl instead. None are external today — every project
// has a local write-up — but the switch is here for a repo that lives entirely elsewhere.
const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    liveUrl: z.string().url().optional(),
    repoUrl: z.string().url().optional(),
    // Typed, not free-form, so a typo fails the build and the badge means something specific:
    //   verified  — CI evidence proves it (conformance / bench / tests), e.g. pg_kafka
    //   live      — reachable and running in prod, e.g. bamcp
    //   beta      — the full app runs on beta/preview; prod is gated / pre-launch, e.g. heistmind
    //   prototype — deployed but partial: real data, incomplete coverage, e.g. tracer
    //   repo-only — source only, nothing deployed
    //   experimental / paused — early, or previously live and now idle
    status: z
      .enum(['verified', 'live', 'beta', 'prototype', 'repo-only', 'experimental', 'paused'])
      .optional(),
    // What the status is anchored to (a CI artifact, a runs dashboard, a verify spec) and the
    // Greenlight verify mode that backs it — so the badge points at evidence instead of asserting.
    evidenceUrl: z.string().url().optional(),
    verifyMode: z.enum(['api', 'playwright', 'test', 'mcp', 'eval', 'agent-web']).optional(),
    order: z.number().default(99),
    external: z.boolean().default(false),
    date: z.coerce.date().optional(),
  }),
});

export const collections = { blog, projects };
