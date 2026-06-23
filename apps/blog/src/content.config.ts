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

// Per-project write-ups, rendered at the top level (/heistmind, /bamcp) by [project].astro.
// The slug = the filename, so it must not collide with a static route (about, blog, rss.xml).
const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    liveUrl: z.string().url().optional(),
    repoUrl: z.string().url().optional(),
    status: z.string().optional(),
    order: z.number().default(99),
    date: z.coerce.date().optional(),
  }),
});

export const collections = { blog, projects };
