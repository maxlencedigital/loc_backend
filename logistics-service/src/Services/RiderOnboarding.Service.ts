import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import {
  ApplicationStatus,
  DOCUMENT_TYPES,
  DocumentType,
  ID_TYPES,
  IRiderApplication,
  VEHICLE_TYPES,
} from "../Models/Rider/Rider.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { email, httpsUrl, isBlank, mask, object, oneOf, optionalUuid, phone, requiredText } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

// The public side of onboarding: someone with no account applies and uploads documents.
// Nothing here grants access; HR decides (HrRider.Service).

/** Every one of these must be on file before an application can be approved. */
export const REQUIRED_DOCUMENTS: readonly DocumentType[] = DOCUMENT_TYPES;

const OPEN: ApplicationStatus[] = ["submitted", "documents_requested", "under_review"];

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const tokenMatches = (supplied: string, storedHash: string): boolean => {
  const a = Buffer.from(sha256(supplied), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const applicationNotFound = () => new CustomException("Application not found.", notFound);

const MESSAGES: Record<ApplicationStatus, string> = {
  submitted: "We have your application. Please upload your documents so it can be reviewed.",
  documents_requested: "We need a few more documents from you before we can continue.",
  under_review: "Your documents are with our team for review.",
  approved: "Your application is approved. Your account will be activated by our team.",
  rejected: "We are unable to take your application forward.",
};

export const missingDocuments = (application: IRiderApplication, uploaded: DocumentType[]): DocumentType[] => {
  if (application.status === "documents_requested") return application.requestedDocuments;
  if (application.status === "submitted") return REQUIRED_DOCUMENTS.filter((type) => !uploaded.includes(type));
  return [];
};

const vehicleNumber = (value: unknown): string => {
  const normalised = requiredText(value, "vehicleNumber", 20).replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{4,15}$/.test(normalised)) throw new CustomException("vehicleNumber is not a valid registration number.", badRequest);
  return normalised;
};

const submit = async (body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const data = {
      name: requiredText(input.name, "name", 100, 2),
      phone: phone(input.phone),
      email: email(input.email),
      city: requiredText(input.city, "city", 80),
      vehicleType: oneOf(input.vehicleType, VEHICLE_TYPES, "vehicleType"),
      vehicleNumber: vehicleNumber(input.vehicleNumber),
      // Only the last four characters are kept: the uploaded documents carry the full numbers.
      drivingLicenceMasked: mask(requiredText(input.drivingLicenceNumber, "drivingLicenceNumber", 30, 5)),
      idType: oneOf(input.idType, ID_TYPES, "idType"),
      idNumberMasked: mask(requiredText(input.idNumber, "idNumber", 30, 4)),
      preferredStoreId: optionalUuid(input.preferredStoreId, "preferredStoreId"),
    };
    // Shown once; only its hash is stored, so a database leak cannot be used to upload documents.
    const uploadToken = crypto.randomBytes(32).toString("hex");

    try {
      const created = await RiderQuery.createApplication({ ...data, openPhone: data.phone, uploadTokenHash: sha256(uploadToken) });
      return { applicationId: created.id, uploadToken, status: created.status };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CustomException("An application with this phone number is already in progress.", conflict);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const uploadDocument = async (id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const token = requiredText(input.uploadToken, "uploadToken", 200);
    const type = oneOf(input.type, DOCUMENT_TYPES, "type");
    const raw = isBlank(input.fileUrl) ? input.file : input.fileUrl;
    if (isBlank(raw)) throw new CustomException("fileUrl is required: upload the file first, then send its https link.", badRequest);
    const fileUrl = httpsUrl(raw, "fileUrl");

    // A wrong id and a wrong token are the same answer, so ids cannot be probed.
    const application = isUuid(id) ? await RiderQuery.findApplicationById(id) : null;
    if (!application || !tokenMatches(token, application.uploadTokenHash)) throw applicationNotFound();
    if (!OPEN.includes(application.status)) throw new CustomException("This application is closed to new documents.", conflict);

    await RiderQuery.upsertDocument(application.id, type, fileUrl);
    const uploaded = (await RiderQuery.listDocuments(application.id)).map((doc) => doc.type);

    // Once everything asked for is in, the application moves to review.
    if (application.status === "documents_requested") {
      const pending = application.requestedDocuments.filter((t) => t !== type);
      await RiderQuery.updateApplication(application.id, ["documents_requested"], {
        requestedDocuments: pending,
        ...(pending.length === 0 ? { status: "under_review" as const } : {}),
      });
    } else if (application.status === "submitted" && REQUIRED_DOCUMENTS.every((t) => uploaded.includes(t))) {
      await RiderQuery.updateApplication(application.id, ["submitted"], { status: "under_review" });
    }
    const after = (await RiderQuery.findApplicationById(application.id)) as IRiderApplication;
    return { type, status: after.status, missingDocuments: missingDocuments(after, uploaded) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const status = async (query: { applicationId?: unknown; phone?: unknown }) => {
  try {
    const id = requiredText(query.applicationId, "applicationId", 64);
    const number = phone(query.phone);
    const application = isUuid(id) ? await RiderQuery.findApplicationById(id) : null;
    // The phone number is the second factor: knowing an application id alone reveals nothing.
    if (!application || application.phone !== number) throw applicationNotFound();
    const uploaded = (await RiderQuery.listDocuments(application.id)).map((doc) => doc.type);
    return {
      status: application.status,
      message: MESSAGES[application.status],
      missingDocuments: missingDocuments(application, uploaded),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RiderOnboardingService = { submit, uploadDocument, status };
