// The documents service, one file per part of the pipeline — this file only gathers them, so `./documents` keeps
// meaning "the services" for index.ts and the tests:
//   upload ──► review ──► library ──► retention        inbox-writes (archive / restore / OCR re-run)
// ocr-payload.ts holds what they share: the `ocr_data` reader and the corrections merge.
export * from "./inbox-writes";
export * from "./library";
export * from "./ocr-payload";
export * from "./retention";
export * from "./review";
export * from "./upload";
