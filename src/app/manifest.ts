import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sistema de Seguimiento Clinico Familiar",
    short_name: "Cuidado Clinico",
    description:
      "Monitoreo farmacologico, bloques de tomas, eventos clinicos recurrentes y alertas via Telegram.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#0F172A",
    lang: "es",
  };
}
