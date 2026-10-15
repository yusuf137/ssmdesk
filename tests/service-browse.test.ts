import assert from "node:assert/strict";
import test from "node:test";

import { SERVICES_PAGE_SIZE } from "../src/lib/constants";
import { browseServices } from "../src/lib/services/browse";
import type { PublicService } from "../src/lib/services/public-service";

function service(partial: Pick<PublicService, "id" | "name" | "category"> & Partial<PublicService>): PublicService {
  return {
    type: "Standart",
    salePrice: 10,
    min: 10,
    max: 1000,
    refill: false,
    cancel: false,
    ...partial,
  };
}

test("browse paginates 50 services and sorts by category then name", () => {
  const services = Array.from({ length: SERVICES_PAGE_SIZE + 1 }, (_, index) =>
    service({
      id: index + 1,
      name: index % 2 === 0 ? "Zebra" : "Alfa",
      category: index < 10 ? "Beta" : "Alfa",
    }),
  );

  const first = browseServices(services, {
    query: "",
    category: "",
    refill: "all",
    cancel: "all",
    page: 1,
  });
  const second = browseServices(services, {
    query: "",
    category: "",
    refill: "all",
    cancel: "all",
    page: 2,
  });

  assert.equal(first.items.length, SERVICES_PAGE_SIZE);
  assert.equal(first.total, SERVICES_PAGE_SIZE + 1);
  assert.equal(second.items.length, 1);
  assert.equal(first.items[0]?.category, "Alfa");
  assert.equal(first.items[0]?.name, "Alfa");
});

test("search, category, refill and cancel filters apply together", () => {
  const services = [
    service({ id: 15, name: "Takipçi", category: "Instagram", refill: true, cancel: true }),
    service({ id: 150, name: "Beğeni", category: "Instagram", refill: false, cancel: true }),
    service({ id: 20, name: "İzlenme", category: "YouTube", refill: true, cancel: false }),
  ];

  const result = browseServices(services, {
    query: "15",
    category: "Instagram",
    refill: "yes",
    cancel: "yes",
    page: 1,
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    [15],
  );
  assert.equal(result.total, 1);
});

test("an empty filter result reports no matches", () => {
  const result = browseServices([service({ id: 1, name: "Takipçi", category: "Instagram" })], {
    query: "olmayan",
    category: "",
    refill: "all",
    cancel: "all",
    page: 1,
  });

  assert.equal(result.total, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.pageCount, 1);
});
