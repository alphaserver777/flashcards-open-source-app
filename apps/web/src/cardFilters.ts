import type { CardFilter } from "./types";

function normalizeCardFilterTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  return tags.reduce<Array<string>>((result, tag) => {
    const normalizedTag = tag.trim();
    const normalizedTagKey = normalizedTag.toLowerCase();
    if (normalizedTag === "" || result.some((value) => value.toLowerCase() === normalizedTagKey)) {
      return result;
    }

    result.push(normalizedTag);
    return result;
  }, []);
}

export function normalizeCardFilter(filter: CardFilter | null): CardFilter | null {
  if (filter === null) {
    return null;
  }

  const normalizedFilter: CardFilter = {
    tags: normalizeCardFilterTags([
      ...filter.tags,
      ...(filter.subject === undefined || filter.subject === null ? [] : [`subject:${filter.subject}`]),
      ...(filter.topics ?? []).map((topic) => `topic:${topic}`),
      ...(filter.difficulty === undefined || filter.difficulty === null ? [] : [`level:${filter.difficulty}`]),
      ...(filter.questionTypes ?? []).map((questionType) => `type:${questionType}`),
    ]),
  };

  if (normalizedFilter.tags.length === 0) {
    return null;
  }

  return normalizedFilter;
}

export function getCardFilterActiveDimensionCount(filter: CardFilter | null): number {
  if (filter === null) {
    return 0;
  }

  const dimensions = new Set(filter.tags.map((tag) => {
    const normalizedTag = tag.toLowerCase();
    return ["subject:", "topic:", "level:", "type:", "material:"]
      .find((prefix) => normalizedTag.startsWith(prefix)) ?? "legacy";
  }));
  return dimensions.size;
}

export function formatCardFilterSummary(filter: CardFilter | null): string {
  if (filter === null) {
    return "No filters";
  }

  const parts: Array<string> = [];
  if (filter.tags.length > 0) {
    parts.push(`tags any of ${filter.tags.join(", ")}`);
  }

  if (parts.length === 0) {
    return "No filters";
  }

  return parts.join(" AND ");
}
