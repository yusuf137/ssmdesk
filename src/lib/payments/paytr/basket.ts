export function formatPaytrMajor(amountMinor: number): string {
  const major = Math.floor(amountMinor / 100);
  const fraction = amountMinor % 100;
  return `${major}.${String(fraction).padStart(2, "0")}`;
}

export function buildUserBasket(serviceName: string, amountMinor: number): string {
  const name = serviceName.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
  const basket = JSON.stringify([[name.length > 0 ? name : "Hizmet", formatPaytrMajor(amountMinor), 1]]);
  return Buffer.from(basket, "utf8").toString("base64");
}
