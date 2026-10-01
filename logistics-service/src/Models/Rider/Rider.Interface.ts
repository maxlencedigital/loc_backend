export const VEHICLE_TYPES = ["bike", "scooter", "bicycle", "ev", "other"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const ID_TYPES = ["aadhaar", "pan", "driving_licence", "voter_id"] as const;
export type IdType = (typeof ID_TYPES)[number];

export const DOCUMENT_TYPES = ["id_proof", "licence", "vehicle_rc", "insurance", "photo"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const APPLICATION_STATUSES = ["submitted", "documents_requested", "under_review", "approved", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const RIDER_STATUSES = ["active", "suspended", "inactive"] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];

export interface IApplicationDocument {
  type: DocumentType;
  fileUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRiderApplication {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  city: string;
  vehicleType: VehicleType;
  vehicleNumber: string;
  drivingLicenceMasked: string;
  idType: IdType;
  idNumberMasked: string;
  preferredStoreId: string | null;
  status: ApplicationStatus;
  openPhone: string | null;
  uploadTokenHash: string;
  requestedDocuments: DocumentType[];
  requestMessage: string | null;
  identityVerified: boolean | null;
  vehicleVerified: boolean | null;
  insuranceValid: boolean | null;
  insuranceExpiry: Date | null;
  verifyNotes: string | null;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNotes: string | null;
  rejectionReason: string | null;
  submittedAt: Date;
}

export type IApplicationCreate = Pick<
  IRiderApplication,
  | "name"
  | "phone"
  | "email"
  | "city"
  | "vehicleType"
  | "vehicleNumber"
  | "drivingLicenceMasked"
  | "idType"
  | "idNumberMasked"
  | "preferredStoreId"
  | "uploadTokenHash"
>;

export type IApplicationPatch = Partial<
  Pick<
    IRiderApplication,
    | "status"
    | "openPhone"
    | "requestedDocuments"
    | "requestMessage"
    | "identityVerified"
    | "vehicleVerified"
    | "insuranceValid"
    | "insuranceExpiry"
    | "verifyNotes"
    | "verifiedByUserId"
    | "verifiedAt"
    | "decidedByUserId"
    | "decidedAt"
    | "decisionNotes"
    | "rejectionReason"
  >
>;

export interface IApplicationFilter {
  status?: ApplicationStatus | null;
  city?: string | null;
  from?: Date | null;
  to?: Date | null;
}

export interface IRider {
  id: string;
  userId: string | null;
  applicationId: string | null;
  name: string;
  phone: string;
  email: string | null;
  city: string;
  vehicleType: VehicleType;
  vehicleNumber: string;
  homeStoreId: string | null;
  status: RiderStatus;
  available: boolean;
  identityVerified: boolean;
  vehicleVerified: boolean;
  insuranceValid: boolean;
  insuranceExpiry: Date | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationAt: Date | null;
  approvedAt: Date | null;
  suspendedReason: string | null;
  suspendedAt: Date | null;
  /** The id of the shift in progress, if any. */
  openShiftId: string | null;
}

export type IRiderCreate = Pick<
  IRider,
  | "userId"
  | "applicationId"
  | "name"
  | "phone"
  | "email"
  | "city"
  | "vehicleType"
  | "vehicleNumber"
  | "homeStoreId"
  | "status"
  | "identityVerified"
  | "vehicleVerified"
  | "insuranceValid"
  | "insuranceExpiry"
> & { approvedByUserId: string | null; approvedAt: Date };

export type IRiderPatch = Partial<
  Pick<
    IRider,
    | "userId"
    | "status"
    | "available"
    | "lastLatitude"
    | "lastLongitude"
    | "lastLocationAt"
    | "suspendedReason"
    | "suspendedAt"
    | "homeStoreId"
  > & { suspendedByUserId: string | null }
>;

export interface IRiderFilter {
  homeStoreId?: string | null;
  available?: boolean | null;
  status?: RiderStatus | null;
}

export interface IShift {
  id: string;
  riderId: string;
  startedAt: Date;
  endedAt: Date | null;
  vehicleChecked: boolean;
  odometerKm: number | null;
  jobsCompleted: number | null;
  distanceMeters: number | null;
  earningsPaise: number | null;
}

export interface IRating {
  rating: number;
  comment: string | null;
  at: Date;
}
