import { isPublicHttpUrl } from "@/lib/orders/schema";

export function OrderLink({ url }: { url: string }) {
  if (!isPublicHttpUrl(url)) {
    return <span className="break-all text-slate-700">{url}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all text-teal-800 underline-offset-2 hover:underline"
    >
      {url}
    </a>
  );
}
