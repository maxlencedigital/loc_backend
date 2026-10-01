import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { text } from "./Input.js";

export const MAX_PHOTO_URL = 500;
const MAX_PHOTO_NOTE = 200;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// There is no file storage yet: a photo is a reference to an image the app already uploaded
// somewhere public. Only plain https links to a named host are accepted, never a local or
// numeric address, so a stored link cannot point a viewer at the internal network.
export const parsePhotoUrl = (value: unknown, field: string): string => {
  const raw = text(value, field, MAX_PHOTO_URL);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CustomException(`${field} must be a valid https link.`, badRequest);
  }
  const host = url.hostname;
  const named = host.includes(".") && !IPV4.test(host) && !host.startsWith("[") && host !== "localhost" && !host.endsWith(".local");
  if (url.protocol !== "https:" || url.username || url.password || !named) {
    throw new CustomException(`${field} must be a valid https link.`, badRequest);
  }
  return url.toString();
};

export const parsePhotoNote = (value: unknown, field: string): string =>
  value === undefined || value === null || value === "" ? "" : text(value, field, MAX_PHOTO_NOTE);
