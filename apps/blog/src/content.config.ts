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
// (/heistmind, /bamcp) via [project].astro — the slug = the filename, so it must not collide
// with a static route (about, blog, projects, rss.xml). `external: true` projects (e.g.
// Greenlight) get no local page; their card links straight out to repoUrl.
const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    liveUrl: z.string().url().optional(),
    repoUrl: z.string().url().optional(),
    status: z.string().optional(),
    order: z.number().default(99),
    external: z.boolean().default(false),
    date: z.coerce.date().optional(),
  }),
});

export const collections = { blog, projects };
