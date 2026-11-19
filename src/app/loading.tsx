export default function ClinicalLoadingSkeleton() {
  return (
    <div
      className="min-h-dvh flex flex-col bg-[#F8FAFC]"
      aria-busy="true"
      aria-label="Cargando consola clinica"
    >
      {/* Skeleton barra superior fija (64px movil / 72px desktop) */}
      <header className="sticky top-0 z-30 bg-[#0F172A] border-b border-[#1E293B]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 h-[64px] sm:h-[72px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-[#1E293B]" />
            <div className="space-y-1.5">
              <div className="h-4 w-56 bg-[#1E293B] rounded-[4px]" />
              <div className="hidden sm:block h-3 w-40 bg-[#1E293B] rounded-[4px]" />
            </div>
          </div>
          <div className="h-[44px] w-28 bg-[#1E293B] rounded-[6px]" />
        </div>
        <div className="bg-white border-b border-[#E2E8F0]">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 h-[48px] flex items-center gap-5 overflow-hidden">
            <div className="h-4 w-28 bg-[#E2E8F0] rounded-[4px]" />
            <div className="h-4 w-24 bg-[#F1F5F9] rounded-[4px]" />
            <div className="h-4 w-36 bg-[#F1F5F9] rounded-[4px]" />
            <div className="h-4 w-28 bg-[#F1F5F9] rounded-[4px]" />
            <div className="h-4 w-24 bg-[#F1F5F9] rounded-[4px]" />
            <div className="h-4 w-24 bg-[#F1F5F9] rounded-[4px]" />
            <div className="h-4 w-24 bg-[#F1F5F9] rounded-[4px]" />
          </div>
        </div>
      </header>

      {/* Skeleton cuerpo principal sin desplazamiento de layout (Zero CLS) */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-10 py-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="clinical-card p-4 space-y-3">
              <div className="h-3.5 w-28 bg-[#E2E8F0] rounded-[4px]" />
              <div className="h-7 w-16 bg-[#CBD5E1] rounded-[4px]" />
              <div className="h-3 w-36 bg-[#F1F5F9] rounded-[4px]" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-4">
            {[0, 1].map((idx) => (
              <div key={idx} className="clinical-card overflow-hidden">
                <div className="px-4 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between">
                  <div className="h-5 w-64 bg-[#E2E8F0] rounded-[4px]" />
                  <div className="h-5 w-28 bg-[#E2E8F0] rounded-[4px]" />
                </div>
                <div className="p-4 space-y-3">
                  <div className="h-10 w-full bg-[#F1F5F9] rounded-[4px]" />
                  <div className="h-10 w-full bg-[#F1F5F9] rounded-[4px]" />
                </div>
                <div className="px-4 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex justify-end">
                  <div className="h-[44px] w-52 bg-[#CBD5E1] rounded-[6px]" />
                </div>
              </div>
            ))}
          </div>

          <aside className="lg:col-span-4 space-y-4">
            {[0, 1].map((idx) => (
              <div key={idx} className="clinical-card p-4 space-y-3">
                <div className="h-5 w-44 bg-[#E2E8F0] rounded-[4px]" />
                <div className="h-20 w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px]" />
                <div className="h-20 w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px]" />
              </div>
            ))}
          </aside>
        </div>
      </main>
    </div>
  );
}
