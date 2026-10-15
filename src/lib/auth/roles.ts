export const USER_ROLES = ["user", "dealer", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type PricingRole = "user" | "dealer";

export function isUserRole(value: unknown): value is UserRole {
  return value === "user" || value === "dealer" || value === "admin";
}

export function roleFromStored(value: unknown): UserRole {
  return isUserRole(value) ? value : "user";
}

export function pricingRoleFor(role: UserRole): PricingRole {
  return role === "dealer" ? "dealer" : "user";
}

export function canAccessAdmin(role: UserRole): boolean {
  return role === "admin";
}

export function canManageDealerPricing(role: UserRole): boolean {
  return role === "dealer" || role === "admin";
}
