import './globals.css';

export const metadata = {
  title: 'Surfmore CRM',
  description: 'Lead management for Surfmore',
};

export default function RootLayout({ children }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
