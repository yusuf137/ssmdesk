import { SERVICES_PAGE_SIZE } from "@/lib/constants";
import type { PublicService } from "@/lib/services/public-service";

export type FlagFilter = "all" | "yes" | "no";

export type ServiceBrowseInput = {
  query: string;
  category: string;
  refill: FlagFilter;
  cancel: FlagFilter;
  page: number;
};

export type ServiceBrowseResult = {
  items: PublicService[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  categories: string[];
};

export function browseServices(
  services: readonly PublicService[],
  input: ServiceBrowseInput,
): ServiceBrowseResult {
  const needle = input.query.trim().toLocaleLowerCase("tr");
  const filtered = services.filter((service) => {
    if (input.category && service.category !== input.category) return false;
    if (!matchesFlag(service.refill, input.refill)) return false;
    if (!matchesFlag(service.cancel, input.cancel)) return false;
    if (!needle) return true;
    const haystack = `${service.name} ${service.category} ${service.id}`.toLocaleLowerCase("tr");
    return haystack.includes(needle);
  });

  filtered.sort((left, right) => {
    const byCategory = left.category.localeCompare(right.category, "tr");
    if (byCategory !== 0) return byCategory;
    return left.name.localeCompare(right.name, "tr");
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / SERVICES_PAGE_SIZE));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const start = (page - 1) * SERVICES_PAGE_SIZE;

  return {
    items: filtered.slice(start, start + SERVICES_PAGE_SIZE),
    total: filtered.length,
    page,
    pageCount,
    pageSize: SERVICES_PAGE_SIZE,
    categories: [...new Set(services.map((service) => service.category))].sort((left, right) =>
      left.localeCompare(right, "tr"),
    ),
  };
}

function matchesFlag(value: boolean, filter: FlagFilter): boolean {
  if (filter === "all") return true;
  return filter === "yes" ? value : !value;
}
