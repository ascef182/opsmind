export const metadata = {
  title: 'OpsMind',
  description: 'Your business data shouldn\'t just be stored. It should work for you.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
