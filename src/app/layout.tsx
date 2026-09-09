import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Vetting de proveedores",
  description:
    "Vetting documental para onboarding de proveedores. Proyecto de portafolio independiente, sin afiliación con la DGCP.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <header className="border-b border-[var(--border)]">
          <nav className="mx-auto flex max-w-5xl items-baseline gap-6 px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Vetting de proveedores
            </Link>
            <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
              Dossiers
            </Link>
            <Link
              href="/revision"
              className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Cola de revisión
            </Link>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>

        {/*
          Required by §11: this is an independent portfolio project and every
          document in it is synthetic. It sits on every page rather than only on
          the README, because a screenshot travels further than a repo does.
        */}
        <footer className="border-t border-[var(--border)]">
          <p className="mx-auto max-w-5xl px-6 py-4 text-xs leading-relaxed text-[var(--muted)]">
            Proyecto de portafolio independiente, <strong>sin afiliación</strong> con la Dirección
            General de Contrataciones Públicas ni con ninguna institución del Estado dominicano.
            Todos los documentos mostrados son <strong>sintéticos</strong> y no corresponden a
            personas ni empresas reales.
          </p>
        </footer>
      </body>
    </html>
  );
}
