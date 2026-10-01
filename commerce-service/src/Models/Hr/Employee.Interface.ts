// Plain domain types for the HR employee record. No ORM types in here.

export const EMPLOYEE_TYPES = ["staff", "rider", "manager", "hr", "admin"] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const EMPLOYEE_STATUSES = ["active", "on_leave", "notice", "exited"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const DOCUMENT_TYPES = ["id_proof", "address_proof", "contract", "certificate", "medical", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ONBOARDING_CATEGORIES = ["documents", "equipment", "access", "training", "induction"] as const;
export type OnboardingCategory = (typeof ONBOARDING_CATEGORIES)[number];

export const ONBOARDING_STATUSES = ["pending", "given", "shown", "done"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export type HistoryField =
  | "designation"
  | "role"
  | "employee_type"
  | "store"
  | "pay_grade"
  | "reporting_to"
  | "status";

export interface IEmployee {
  id: string;
  code: string;
  name: string;
  employeeType: EmployeeType;
  phone: string;
  email: string | null;
  storeId: string | null;
  role: string;
  designation: string | null;
  payGrade: string | null;
  joinDate: Date;
  dateOfBirth: Date | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;
  bankHolderName: string | null;
  bankAccountLast4: string | null;
  bankAccountEnc: string | null;
  bankIfsc: string | null;
  gatewayUserId: string | null;
  reportingTo: string | null;
  status: EmployeeStatus;
  lastWorkingDay: Date | null;
  exitReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IEmployeeCreate = Omit<IEmployee, "id" | "code" | "lastWorkingDay" | "exitReason" | "createdAt" | "updatedAt">;
export type IEmployeeUpdate = Partial<Omit<IEmployee, "id" | "code" | "createdAt" | "updatedAt">>;

/** What other packages get from EmployeeAccess: identity and placement, nothing sensitive. */
export interface IEmployeeRef {
  id: string;
  code: string;
  name: string;
  employeeType: EmployeeType;
  storeId: string | null;
  role: string;
  designation: string | null;
  status: EmployeeStatus;
  gatewayUserId: string | null;
  reportingTo: string | null;
  joinDate: Date;
}

export interface IEmployeeFilter {
  storeId: string | null;
  employeeType?: EmployeeType;
  status?: EmployeeStatus;
  q?: string;
  offset: number;
  limit: number;
}

export interface IEmployeeDocument {
  id: string;
  employeeId: string;
  type: DocumentType;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedByUserId: string | null;
  uploadedAt: Date;
}

export type IEmployeeDocumentCreate = Omit<IEmployeeDocument, "id" | "uploadedAt">;

export interface ITemplateItem {
  title: string;
  category: OnboardingCategory;
}

export interface IOnboardingItem {
  id: string;
  employeeId: string;
  position: number;
  title: string;
  category: OnboardingCategory;
  status: OnboardingStatus;
  note: string | null;
  doneAt: Date | null;
}

export interface IHistoryEntryCreate {
  employeeId: string;
  field: HistoryField;
  fromValue: string | null;
  toValue: string | null;
  effectiveDate: Date;
  reason: string | null;
  changedByUserId: string | null;
  changedByName: string;
}

export interface IHistoryEntry extends IHistoryEntryCreate {
  id: string;
  createdAt: Date;
}

export interface IHeadcount {
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byStore: Record<string, number>;
}
