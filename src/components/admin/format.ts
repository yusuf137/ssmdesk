export function formatMinorAmount(minor: number | null, currency: string | null): string {
  if (minor === null || !Number.isSafeInteger(minor)) return "Alınamadı";
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  const grouped = new Intl.NumberFormat("tr-TR").format(major);
  const label = `${negative ? "-" : ""}${grouped},${fraction}`;
  return currency ? `${label} ${currency}` : label;
}

export function balanceLevelLabel(level: string | null): string {
  if (level === "normal") return "Normal";
  if (level === "low") return "Düşük";
  if (level === "critical") return "Kritik";
  return "Bilinmiyor";
}
