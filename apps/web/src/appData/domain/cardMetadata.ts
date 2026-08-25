import type { CardMetadata, CardSourceMetadata, ProfessorItCardMetadata } from "../../types";

type CardMetadataRecord = Readonly<Record<string, unknown>>;

function expectCardMetadataRecord(value: unknown, context: string): CardMetadataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }

  return value as CardMetadataRecord;
}

function expectNullableCardMetadataString(value: unknown, fieldName: string): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }

  throw new Error(`${fieldName} must be a string or null`);
}

function normalizeCardSourceMetadata(value: unknown): CardSourceMetadata | null {
  if (value === null) {
    return null;
  }

  const record = expectCardMetadataRecord(value, "metadata.source");
  return {
    label: expectNullableCardMetadataString(record.label, "metadata.source.label"),
    author: expectNullableCardMetadataString(record.author, "metadata.source.author"),
    comment: expectNullableCardMetadataString(record.comment, "metadata.source.comment"),
    createdAt: expectNullableCardMetadataString(record.createdAt, "metadata.source.createdAt"),
    importedAt: expectNullableCardMetadataString(record.importedAt, "metadata.source.importedAt"),
    importId: expectNullableCardMetadataString(record.importId, "metadata.source.importId"),
  };
}

function expectNonEmptyMetadataString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${fieldName} must be a non-empty string`);
  return value.trim();
}

function normalizeProfessorItCardMetadata(value: unknown): ProfessorItCardMetadata | undefined {
  if (value === undefined) return undefined;
  const record = expectCardMetadataRecord(value, "metadata.professorIt");
  const difficulty = expectNonEmptyMetadataString(record.difficulty, "metadata.professorIt.difficulty");
  const questionType = expectNonEmptyMetadataString(record.questionType, "metadata.professorIt.questionType");
  const publicationStatus = expectNonEmptyMetadataString(record.publicationStatus, "metadata.professorIt.publicationStatus");
  if (difficulty !== "junior" && difficulty !== "middle" && difficulty !== "senior") throw new Error("Unsupported Professor IT difficulty");
  if (questionType !== "theory" && questionType !== "command" && questionType !== "case") throw new Error("Unsupported Professor IT question type");
  if (publicationStatus !== "draft" && publicationStatus !== "published" && publicationStatus !== "archived") throw new Error("Unsupported Professor IT publication status");
  return {
    sharedCardId: expectNonEmptyMetadataString(record.sharedCardId, "metadata.professorIt.sharedCardId"),
    subject: expectNonEmptyMetadataString(record.subject, "metadata.professorIt.subject"),
    topic: expectNonEmptyMetadataString(record.topic, "metadata.professorIt.topic"),
    difficulty,
    questionType,
    lmsLessonId: expectNullableCardMetadataString(record.lmsLessonId, "metadata.professorIt.lmsLessonId"),
    lmsLessonTitle: expectNullableCardMetadataString(record.lmsLessonTitle, "metadata.professorIt.lmsLessonTitle"),
    lmsLessonUrl: expectNullableCardMetadataString(record.lmsLessonUrl, "metadata.professorIt.lmsLessonUrl"),
    interviewSource: expectNullableCardMetadataString(record.interviewSource ?? null, "metadata.professorIt.interviewSource"),
    publicationStatus,
  };
}

export function normalizeCardType(value: unknown): string {
  if (value === undefined) {
    return "basic";
  }

  if (typeof value !== "string") {
    throw new Error("cardType must be a string when present");
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? "basic" : trimmedValue;
}

export function makeDefaultCardSourceMetadata(createdAt: string): CardSourceMetadata {
  return {
    label: null,
    author: null,
    comment: null,
    createdAt,
    importedAt: null,
    importId: null,
  };
}

export function makeDefaultCardMetadata(createdAt: string): CardMetadata {
  return {
    version: 1,
    source: makeDefaultCardSourceMetadata(createdAt),
  };
}

export function normalizeCardMetadata(value: unknown, createdAt: string): CardMetadata {
  if (value === undefined) {
    return makeDefaultCardMetadata(createdAt);
  }

  const record = expectCardMetadataRecord(value, "metadata");
  if (record.version !== 1) {
    throw new Error("metadata.version must be 1");
  }

  return {
    version: 1,
    source: normalizeCardSourceMetadata(record.source),
    ...(record.professorIt === undefined ? {} : { professorIt: normalizeProfessorItCardMetadata(record.professorIt) }),
  };
}

export function resolveCardRendererType(cardType: string): "basic" {
  void cardType;
  return "basic";
}
