export function ConfigurationError() {
  return (
    <main className="flex flex-1 items-center justify-center bg-[#f4f6f8] px-6 py-16">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-950">Yapılandırma eksik</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Sunucu kimlik doğrulaması henüz tamamlanmamış. Yönetici ortam değişkenlerini kontrol etmeli.
        </p>
      </div>
    </main>
  );
}
