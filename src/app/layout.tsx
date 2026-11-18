import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sistema de Seguimiento Clinico y Cuidado Familiar",
  description:
    "Plataforma de monitoreo farmacologico intensivo, optimizacion de tomas, eventos clinicos recurrentes, gestion de casos y alertas bidireccionales via Telegram.",
  applicationName: "Cuidado Clinico",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Cuidado Clinico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F172A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-radius="sharp"
      className={`${atkinson.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-dvh bg-[#F8FAFC] text-[#0F172A] antialiased">
        <a className="skip-link" href="#main-content">
          Saltar al contenido principal
        </a>
        {children}
      </body>
    </html>
  );
}
