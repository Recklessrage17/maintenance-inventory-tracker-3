export const USER_ROLES = [
  "maintenanceAdmin",
  "maintenanceManager",
  "seniorMaintenance",
  "maintTech1",
  "maintTech2",
  "maintTech3"
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type Permission =
  | "inventory:view"
  | "inventory:create"
  | "inventory:edit"
  | "inventory:delete"
  | "inventory:stock"
  | "inventory:scan"
  | "reorder:manage"
  | "reorder:request"
  | "vendors:view"
  | "vendors:manage"
  | "vendors:delete"
  | "locations:view"
  | "locations:manage"
  | "locations:delete"
  | "requisitions:create"
  | "requisitions:view"
  | "requisitions:print"
  | "history:view"
  | "reports:export"
  | "data:import"
  | "data:export"
  | "settings:manage"
  | "users:manage"
  | "users:manageLowerRanks"
  | "users:assignRoles"
  | "appData:deleteAll";

export const DEFAULT_USER_ROLE: UserRole = "maintenanceAdmin";
export const PERMISSION_DENIED_MESSAGE = "Your rank does not have permission for this action.";

export const ROLE_LABELS: Record<UserRole, string> = {
  maintenanceAdmin: "Maintenance Admin",
  maintenanceManager: "Maintenance Manager",
  seniorMaintenance: "Senior Maintenance",
  maintTech1: "Maint Tech 1",
  maintTech2: "Maint Tech 2",
  maintTech3: "Maint Tech 3"
};

export const ROLE_RANK: Record<UserRole, number> = {
  maintenanceAdmin: 6,
  maintenanceManager: 5,
  seniorMaintenance: 4,
  maintTech1: 3,
  maintTech2: 2,
  maintTech3: 1
};

const ALL_PERMISSIONS: readonly Permission[] = [
  "inventory:view",
  "inventory:create",
  "inventory:edit",
  "inventory:delete",
  "inventory:stock",
  "inventory:scan",
  "reorder:manage",
  "reorder:request",
  "vendors:view",
  "vendors:manage",
  "vendors:delete",
  "locations:view",
  "locations:manage",
  "locations:delete",
  "requisitions:create",
  "requisitions:view",
  "requisitions:print",
  "history:view",
  "reports:export",
  "data:import",
  "data:export",
  "settings:manage",
  "users:manage",
  "users:manageLowerRanks",
  "users:assignRoles",
  "appData:deleteAll"
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  maintenanceAdmin: ALL_PERMISSIONS,
  maintenanceManager: [
    "inventory:view",
    "inventory:create",
    "inventory:edit",
    "inventory:stock",
    "inventory:scan",
    "reorder:manage",
    "reorder:request",
    "vendors:view",
    "vendors:manage",
    "locations:view",
    "locations:manage",
    "requisitions:create",
    "requisitions:view",
    "requisitions:print",
    "history:view",
    "reports:export",
    "data:export",
    "users:manageLowerRanks",
    "users:assignRoles"
  ],
  seniorMaintenance: [
    "inventory:view",
    "inventory:create",
    "inventory:edit",
    "inventory:stock",
    "inventory:scan",
    "reorder:manage",
    "reorder:request",
    "vendors:view",
    "locations:view",
    "requisitions:create",
    "requisitions:view",
    "history:view",
    "reports:export"
  ],
  maintTech1: [
    "inventory:view",
    "inventory:stock",
    "inventory:scan",
    "reorder:request",
    "vendors:view",
    "locations:view"
  ],
  maintTech2: [
    "inventory:view",
    "inventory:stock",
    "inventory:scan",
    "vendors:view",
    "locations:view"
  ],
  maintTech3: ["inventory:view", "inventory:scan", "vendors:view", "locations:view"]
};

export const normalizeUserRole = (role: unknown): UserRole => {
  if (typeof role === "string" && (USER_ROLES as readonly string[]).includes(role)) {
    return role as UserRole;
  }

  return DEFAULT_USER_ROLE;
};

export const getRoleLabel = (role: unknown) => ROLE_LABELS[normalizeUserRole(role)];

export const hasPermission = (role: unknown, permission: Permission) => ROLE_PERMISSIONS[normalizeUserRole(role)].includes(permission);

export const isAdminRole = (role: unknown) => normalizeUserRole(role) === "maintenanceAdmin";

export const canManageRole = (actorRole: unknown, targetRole: unknown) => {
  const actor = normalizeUserRole(actorRole);
  const target = normalizeUserRole(targetRole);

  if (actor === "maintenanceAdmin") {
    return true;
  }

  if (target === "maintenanceAdmin") {
    return false;
  }

  return ROLE_RANK[actor] > ROLE_RANK[target];
};

export const canAssignRole = (actorRole: unknown, targetRole: unknown) => {
  const actor = normalizeUserRole(actorRole);
  const target = normalizeUserRole(targetRole);

  if (actor === "maintenanceAdmin") {
    return true;
  }

  return target !== "maintenanceAdmin" && ROLE_RANK[actor] > ROLE_RANK[target];
};
