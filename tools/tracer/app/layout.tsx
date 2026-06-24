import type { ReactNode } from 'react';

export const metadata = {
  title: 'Neon probe',
  description: 'A minimal Next-on-Neon Greenlight tool.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
