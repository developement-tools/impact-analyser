export default defineEventHandler(() => useDb().rows.map(formatRow));
