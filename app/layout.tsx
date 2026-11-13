import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Final Fore Media',
  description: 'Media planning and reporting',
  icons: { icon: { url: '/brand/favicon.png', type: 'image/png', sizes: '32x32' } },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><link rel="stylesheet" href="/brand/theme.css" /></head><body>{children}</body></html>;
}
