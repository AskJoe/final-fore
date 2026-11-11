import type { Metadata } from 'next';
export const metadata: Metadata={title:'Final Fore',description:'Media planning and reporting'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
