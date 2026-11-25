export function useDb() {
  return { rows: [] as string[] };
}

export const formatRow = (row: string) => row.trim();
