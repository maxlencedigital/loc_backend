import type { Request } from "express";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// A small multipart/form-data reader for the two upload endpoints (receipts and bank
// statements). The body is read whole under a hard size cap, so there is no streaming to
// get wrong; anything malformed is a 400.

const PAYLOAD_TOO_LARGE = 413;
const MAX_PARTS = 10;

export interface UploadedFile {
  field: string;
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: UploadedFile[];
}

const malformed = () => new CustomException("The upload is not valid multipart form data.", badRequest);

const boundaryOf = (contentType: string | undefined): string => {
  if (!contentType || !/^multipart\/form-data/i.test(contentType)) {
    throw new CustomException("Send the file as multipart/form-data.", badRequest);
  }
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2]?.trim();
  if (!boundary || boundary.length > 200) throw malformed();
  return boundary;
};

const cleanFileName = (raw: string): string => {
  // Only the base name, no control characters, bounded: it is stored and shown, never used as a path.
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 200);
  return cleaned || "upload";
};

export const parseMultipart = (body: Buffer, contentType: string | undefined): ParsedMultipart => {
  const boundary = boundaryOf(contentType);
  const delimiter = Buffer.from(`--${boundary}`);
  const closer = Buffer.from(`\r\n--${boundary}`);
  const result: ParsedMultipart = { fields: {}, files: [] };

  let position = body.indexOf(delimiter);
  if (position < 0) throw malformed();
  let parts = 0;
  for (;;) {
    position += delimiter.length;
    if (body.subarray(position, position + 2).toString() === "--") break;
    if (body[position] !== 13 || body[position + 1] !== 10) throw malformed();
    position += 2;
    if (++parts > MAX_PARTS) throw new CustomException("Too many parts in the upload.", badRequest);

    const headerEnd = body.indexOf("\r\n\r\n", position);
    if (headerEnd < 0) throw malformed();
    const headers = body.subarray(position, headerEnd).toString("utf8");
    const contentStart = headerEnd + 4;
    const next = body.indexOf(closer, contentStart);
    if (next < 0) throw malformed();
    const content = body.subarray(contentStart, next);

    const disposition = /^content-disposition:[^\r\n]*$/im.exec(headers)?.[0] ?? "";
    const name = /[; ]name="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) throw malformed();
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1];
    if (fileName !== undefined) {
      const type = /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1]?.trim().toLowerCase() ?? "application/octet-stream";
      result.files.push({ field: name, fileName: cleanFileName(fileName), contentType: type, content: Buffer.from(content) });
    } else {
      result.fields[name] = content.toString("utf8").slice(0, 1000);
    }
    position = next + 2;
  }
  return result;
};

/** Reads and parses a multipart request, refusing anything over `maxBytes` with 413. */
export const readMultipart = (req: Request, maxBytes: number): Promise<ParsedMultipart> =>
  new Promise((resolve, reject) => {
    // Refuse a non-multipart request before waiting on a body another parser may already have consumed.
    try {
      boundaryOf(req.header("content-type"));
    } catch (error) {
      return reject(error);
    }
    const declared = Number(req.header("content-length") ?? 0);
    if (declared > maxBytes) {
      return reject(new CustomException("The file is too large.", PAYLOAD_TOO_LARGE));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        req.pause();
        return reject(new CustomException("The file is too large.", PAYLOAD_TOO_LARGE));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        resolve(parseMultipart(Buffer.concat(chunks), req.header("content-type")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", () => {
      if (!done) {
        done = true;
        reject(malformed());
      }
    });
  });
