export type ComplianceType = "licence" | "registration" | "certificate" | "permit" | "other";
export type ComplianceStatus = "valid" | "expiring" | "expired";

export const COMPLIANCE_TYPES: ComplianceType[] = ["licence", "registration", "certificate", "permit", "other"];
export const COMPLIANCE_STATUSES: ComplianceStatus[] = ["valid", "expiring", "expired"];

export interface IChecklistEntry {
  title: string;
  done: boolean;
}

/** A pointer to a file kept elsewhere: this service stores no file bytes. */
export interface IFileRef {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  caption?: string;
  addedBy: string;
  addedAt: string;
}

export interface IComplianceItem {
  id: string;
  name: string;
  type: ComplianceType;
  authority: string | null;
  referenceNumber: string | null;
  issuedOn: Date | null;
  expiresOn: Date;
  storeId: string | null;
  ownerId: string | null;
  checklist: IChecklistEntry[];
  documents: IFileRef[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComplianceRenewal {
  id: string;
  itemId: string;
  previousExpiresOn: Date;
  newExpiresOn: Date;
  previousReferenceNumber: string | null;
  referenceNumber: string | null;
  renewedBy: string;
  renewedAt: Date;
}

export type IComplianceCreate = Pick<
  IComplianceItem,
  "name" | "type" | "authority" | "referenceNumber" | "issuedOn" | "expiresOn" | "storeId" | "ownerId" | "createdBy"
>;

export type IComplianceUpdate = Partial<
  Pick<
    IComplianceItem,
    "name" | "type" | "authority" | "referenceNumber" | "issuedOn" | "expiresOn" | "storeId" | "ownerId"
  >
>;

/** The date window each derived status stands for, in whole days from today. */
export interface IComplianceFilter {
  type?: ComplianceType;
  status?: ComplianceStatus;
  /** Visible stores: a store plus company-wide items, or everything when null. */
  scope: string | null;
  /** An explicit store filter, already checked against the scope. */
  storeId?: string;
  today: Date;
  expiringUntil: Date;
}

export interface IComplianceCounts {
  expired: number;
  expiring: number;
  valid: number;
}
