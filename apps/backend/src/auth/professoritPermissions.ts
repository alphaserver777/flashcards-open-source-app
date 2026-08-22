const professorItAuthorUserIdsVariable = "PROFESSORIT_AUTHOR_USER_IDS";

function loadProfessorItAuthorUserIds(): ReadonlySet<string> {
  const rawValue = process.env[professorItAuthorUserIdsVariable] ?? "";
  return new Set(rawValue.split(",").map((value) => value.trim()).filter((value) => value !== ""));
}

export function canManageProfessorItSharedContent(userId: string): boolean {
  if (process.env.AUTH_MODE !== "professorit") {
    return true;
  }

  return loadProfessorItAuthorUserIds().has(userId);
}
