export const metadata = { title: 'Watchman', description: 'Strategic-alignment review for pull requests' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
